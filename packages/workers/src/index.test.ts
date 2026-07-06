import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertWorkerManifest,
  createBackgroundWorker,
  createScheduledJob,
  createWorkerClient,
  createWorkerHost,
  describeWorkerTask,
  isBrowserWorker,
  validateWorkerManifest,
  type WorkerHostScope,
  type WorkerLike,
  WorkerManifestError,
  type WorkerRequestMessage,
  WorkerTaskCancelledError,
  workerRuntimeLabel,
} from "./index";

describe("@mvp/workers", () => {
  it("validates WorkerManifest at runtime without throwing", () => {
    const result = validateWorkerManifest({
      id: "image-resize",
      kind: "dedicated-worker",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.privacy).toBe("public");
  });

  it("reports service worker policy issues", () => {
    expect(
      validateWorkerManifest({
        id: "offline",
        kind: "service-worker",
      }),
    ).toEqual({
      ok: false,
      issues: ['service worker "offline" must declare scope'],
    });

    expect(() =>
      assertWorkerManifest({
        id: "offline-private",
        kind: "service-worker",
        scope: "/",
        privacy: "user-private",
        cachePolicy: { ttl: 60, tags: [], vary: ["tenant"] },
      }),
    ).toThrow(WorkerManifestError);
  });

  it("describes cancellable worker tasks", () => {
    const task = describeWorkerTask(
      {
        id: "image-resize",
        kind: "dedicated-worker",
        privacy: "tenant",
      },
      {
        name: "resize",
        payload: { width: 320 },
        traceId: "trace-worker",
      },
    );

    expect(task).toEqual({
      id: "image-resize:resize",
      workerId: "image-resize",
      kind: "dedicated-worker",
      name: "resize",
      privacy: "tenant",
      cancellable: true,
      payload: { width: 320 },
      traceId: "trace-worker",
      cacheKey: undefined,
    });
  });

  it("requires user partition when describing private service worker cache tasks", () => {
    expect(() =>
      describeWorkerTask(
        {
          id: "offline-private",
          kind: "service-worker",
          scope: "/",
          privacy: "user-private",
          cachePolicy: { ttl: 0, tags: [], vary: ["tenant"] },
        },
        {
          name: "cache-html",
          payload: { route: "/account" },
        },
      ),
    ).toThrow(WorkerManifestError);

    expect(
      describeWorkerTask(
        {
          id: "offline-private",
          kind: "service-worker",
          scope: "/",
          privacy: "user-private",
          cachePolicy: { ttl: 0, tags: [], vary: ["tenant"] },
        },
        {
          name: "cache-html",
          payload: { route: "/account" },
          userPartitionKey: "user-1",
        },
      ).cancellable,
    ).toBe(false);
  });

  it("classifies worker runtime labels", () => {
    expect(isBrowserWorker({ id: "shared", kind: "shared-worker" })).toBe(true);
    expect(isBrowserWorker({ id: "queue", kind: "queue-worker" })).toBe(false);
    expect(
      workerRuntimeLabel({ id: "server", kind: "server-background" }),
    ).toBe("server background");
  });
});

const backgroundManifest = {
  id: "email",
  kind: "server-background" as const,
  privacy: "tenant" as const,
};

function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createBackgroundWorker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects non-server worker manifests", () => {
    expect(() =>
      createBackgroundWorker(
        { id: "image-resize", kind: "dedicated-worker" },
        { handler: vi.fn() },
      ),
    ).toThrow(WorkerManifestError);
  });

  it("processes tasks under the concurrency limit and propagates trace ids", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const seenTraceIds: Array<string | undefined> = [];
    const gates = [
      createDeferred(),
      createDeferred(),
      createDeferred(),
      createDeferred(),
    ];
    let started = 0;
    const worker = createBackgroundWorker<{ index: number }>(
      backgroundManifest,
      {
        concurrency: 2,
        handler: async (task) => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          seenTraceIds.push(task.traceId);
          const gate = gates[started];
          started += 1;
          await gate?.promise;
          concurrent -= 1;
        },
      },
    );

    const completions = [0, 1, 2, 3].map(
      (index) =>
        worker.enqueue({
          name: "send",
          payload: { index },
          traceId: `trace-${index}`,
          requestId: `req-${index}`,
        }).completion,
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(worker.stats()).toEqual({ queued: 2, running: 2, deadLetters: 0 });

    for (const gate of gates) gate.resolve();
    const results = await Promise.all(completions);

    expect(maxConcurrent).toBe(2);
    expect(results.every((result) => result.status === "completed")).toBe(true);
    expect(seenTraceIds).toEqual(["trace-0", "trace-1", "trace-2", "trace-3"]);
    await worker.stop();
  });

  it("retries with backoff before succeeding", async () => {
    let attemptCount = 0;
    const worker = createBackgroundWorker(backgroundManifest, {
      maxAttempts: 3,
      backoffMs: 1000,
      handler: async () => {
        attemptCount += 1;
        if (attemptCount < 3) throw new Error("transient");
      },
    });

    const { completion } = worker.enqueue({ name: "send", payload: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(attemptCount).toBe(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(attemptCount).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attemptCount).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);

    const result = await completion;
    expect(result).toMatchObject({ status: "completed", attempts: 3 });
    await worker.stop();
  });

  it("moves exhausted tasks to the dead-letter queue", async () => {
    const worker = createBackgroundWorker(backgroundManifest, {
      maxAttempts: 2,
      backoffMs: 100,
      handler: async () => {
        throw new Error("permanent failure");
      },
    });

    const { completion } = worker.enqueue({
      name: "send",
      payload: { to: "a@b.c" },
      traceId: "trace-dead",
      requestId: "req-dead",
    });
    await vi.advanceTimersByTimeAsync(100);

    const result = await completion;
    expect(result).toMatchObject({
      status: "dead-letter",
      attempts: 2,
      error: "permanent failure",
    });

    const [entry] = worker.deadLetters();
    expect(entry?.error).toBe("permanent failure");
    expect(entry?.task).toMatchObject({
      traceId: "trace-dead",
      requestId: "req-dead",
      workerId: "email",
    });
    await worker.stop();
  });

  it("stops gracefully: finishes running tasks and cancels queued ones", async () => {
    const gate = createDeferred();
    let finishedFirst = false;
    const worker = createBackgroundWorker(backgroundManifest, {
      handler: async () => {
        await gate.promise;
        finishedFirst = true;
      },
    });

    const first = worker.enqueue({ name: "send", payload: { index: 0 } });
    const second = worker.enqueue({ name: "send", payload: { index: 1 } });
    await vi.advanceTimersByTimeAsync(0);

    const stopPromise = worker.stop();
    gate.resolve();
    await stopPromise;

    expect(finishedFirst).toBe(true);
    await expect(first.completion).resolves.toMatchObject({
      status: "completed",
    });
    await expect(second.completion).resolves.toMatchObject({
      status: "cancelled",
    });
    expect(() => worker.enqueue({ name: "send", payload: {} })).toThrow(
      WorkerManifestError,
    );
  });
});

describe("createScheduledJob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs on the interval until stopped", async () => {
    const handler = vi.fn();
    const job = createScheduledJob({
      id: "cleanup",
      intervalMs: 1000,
      handler,
    });

    job.start();
    expect(job.running).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenLastCalledWith({ runCount: 3 });

    job.stop();
    expect(job.running).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(handler).toHaveBeenCalledTimes(3);
    expect(job.runCount).toBe(3);
  });

  it("skips overlapping runs and reports handler errors", async () => {
    const gate = createDeferred();
    const errors: unknown[] = [];
    let calls = 0;
    const job = createScheduledJob({
      id: "sync",
      intervalMs: 1000,
      handler: async () => {
        calls += 1;
        if (calls === 1) await gate.promise;
        if (calls === 2) throw new Error("sync failed");
      },
      onError: (error) => errors.push(error),
    });

    job.start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(calls).toBe(1);

    gate.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    expect(errors).toHaveLength(1);
    job.stop();
  });

  it("accepts an injected clock", () => {
    const callbacks: Array<() => void> = [];
    const clearSpy = vi.fn();
    const job = createScheduledJob({
      id: "custom-clock",
      intervalMs: 60_000,
      handler: vi.fn(),
      clock: {
        setInterval: (callback) => {
          callbacks.push(callback);
          return "handle-1";
        },
        clearInterval: clearSpy,
      },
    });

    job.start();
    expect(callbacks).toHaveLength(1);
    callbacks[0]?.();
    expect(job.runCount).toBe(1);
    job.stop();
    expect(clearSpy).toHaveBeenCalledWith("handle-1");
  });
});

type MockWorker = WorkerLike & {
  posted: unknown[];
  emit: (data: unknown) => void;
  terminate: ReturnType<typeof vi.fn<() => void>>;
};

function createMockWorker(): MockWorker {
  const listeners = new Set<(event: { data: unknown }) => void>();
  const posted: unknown[] = [];
  return {
    posted,
    postMessage(message: unknown) {
      posted.push(message);
    },
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    terminate: vi.fn<() => void>(),
    emit(data: unknown) {
      for (const listener of listeners) listener({ data });
    },
  };
}

const browserManifest = {
  id: "image-resize",
  kind: "dedicated-worker" as const,
  privacy: "public" as const,
};

describe("createWorkerClient", () => {
  it("rejects server-side manifests", () => {
    expect(() =>
      createWorkerClient(
        { id: "queue", kind: "queue-worker" },
        { createWorker: createMockWorker },
      ),
    ).toThrow(WorkerManifestError);
  });

  it("runs typed tasks over the request/response protocol", async () => {
    const worker = createMockWorker();
    const client = createWorkerClient<{ width: number }, { url: string }>(
      browserManifest,
      { createWorker: () => worker },
    );

    const task = client.run("resize", { width: 320 }, { traceId: "trace-w" });
    expect(worker.posted[0]).toEqual({
      type: "request",
      taskId: "image-resize:resize:1",
      name: "resize",
      payload: { width: 320 },
      traceId: "trace-w",
    });

    worker.emit({
      type: "response",
      taskId: task.taskId,
      ok: true,
      result: { url: "/img.webp" },
    });
    await expect(task.result).resolves.toEqual({ url: "/img.webp" });
  });

  it("rejects the task when the worker responds with an error", async () => {
    const worker = createMockWorker();
    const client = createWorkerClient(browserManifest, {
      createWorker: () => worker,
    });

    const task = client.run("resize", { width: -1 });
    worker.emit({
      type: "response",
      taskId: task.taskId,
      ok: false,
      error: "invalid width",
    });
    await expect(task.result).rejects.toThrow("invalid width");
  });

  it("cancels tasks and enforces manifest cancellability", async () => {
    const worker = createMockWorker();
    const client = createWorkerClient(browserManifest, {
      createWorker: () => worker,
    });

    const task = client.run("resize", { width: 320 });
    task.cancel();
    expect(worker.posted[1]).toEqual({ type: "cancel", taskId: task.taskId });
    await expect(task.result).rejects.toThrow(WorkerTaskCancelledError);

    // a late response for the cancelled task is ignored
    worker.emit({
      type: "response",
      taskId: task.taskId,
      ok: true,
      result: {},
    });

    const fixed = client.run("resize", { width: 100 }, { cancellable: false });
    expect(() => fixed.cancel()).toThrow(WorkerManifestError);
  });

  it("terminates the worker and rejects in-flight tasks", async () => {
    const worker = createMockWorker();
    const client = createWorkerClient(browserManifest, {
      createWorker: () => worker,
    });

    const task = client.run("resize", { width: 320 });
    client.terminate();
    await expect(task.result).rejects.toThrow(WorkerTaskCancelledError);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});

describe("createWorkerHost", () => {
  function createMockScope() {
    const listeners = new Set<(event: { data: unknown }) => void>();
    const posted: unknown[] = [];
    const scope: WorkerHostScope & {
      posted: unknown[];
      emit: (data: unknown) => void;
    } = {
      posted,
      postMessage(message: unknown) {
        posted.push(message);
      },
      addEventListener(_type, listener) {
        listeners.add(listener);
      },
      emit(data: unknown) {
        for (const listener of listeners) listener({ data });
      },
    };
    return scope;
  }

  it("dispatches requests to handlers and posts responses", async () => {
    const scope = createMockScope();
    createWorkerHost<{ width: number }, { url: string }>(scope, {
      resize: async (payload, context) => {
        expect(context.traceId).toBe("trace-w");
        return { url: `/img-${payload.width}.webp` };
      },
    });

    scope.emit({
      type: "request",
      taskId: "t-1",
      name: "resize",
      payload: { width: 320 },
      traceId: "trace-w",
    } satisfies WorkerRequestMessage<{ width: number }>);
    await vi.waitFor(() => expect(scope.posted).toHaveLength(1));
    expect(scope.posted[0]).toEqual({
      type: "response",
      taskId: "t-1",
      ok: true,
      result: { url: "/img-320.webp" },
    });
  });

  it("responds with errors for failing or unknown handlers", async () => {
    const scope = createMockScope();
    createWorkerHost(scope, {
      resize: async () => {
        throw new Error("resize failed");
      },
    });

    scope.emit({ type: "request", taskId: "t-1", name: "resize", payload: {} });
    scope.emit({
      type: "request",
      taskId: "t-2",
      name: "unknown",
      payload: {},
    });
    await vi.waitFor(() => expect(scope.posted).toHaveLength(2));
    expect(scope.posted).toEqual(
      expect.arrayContaining([
        { type: "response", taskId: "t-1", ok: false, error: "resize failed" },
        expect.objectContaining({ taskId: "t-2", ok: false }),
      ]),
    );
  });

  it("aborts cancelled tasks and suppresses their responses", async () => {
    const scope = createMockScope();
    const gate = createDeferred<string>();
    let aborted = false;
    createWorkerHost(scope, {
      resize: async (_payload, context) => {
        context.signal.addEventListener("abort", () => {
          aborted = true;
          gate.resolve("aborted");
        });
        return gate.promise;
      },
    });

    scope.emit({ type: "request", taskId: "t-1", name: "resize", payload: {} });
    scope.emit({ type: "cancel", taskId: "t-1" });
    await vi.waitFor(() => expect(aborted).toBe(true));
    await Promise.resolve();
    expect(scope.posted).toHaveLength(0);
  });
});
