import {
  type DataPrivacy,
  type WorkerManifest,
  WorkerManifestSchema,
} from "@mvp/contracts";

export type WorkerManifestValidationResult =
  | { ok: true; manifest: WorkerManifest; issues: [] }
  | { ok: false; issues: string[] };

export type WorkerTaskDescription<TPayload = unknown> = {
  id: string;
  workerId: string;
  kind: WorkerManifest["kind"];
  name: string;
  privacy: DataPrivacy;
  cancellable: boolean;
  payload: TPayload;
  traceId?: string;
  cacheKey?: string;
};

export type DescribeWorkerTaskOptions<TPayload = unknown> = {
  id?: string;
  name: string;
  payload: TPayload;
  traceId?: string;
  cancellable?: boolean;
  cacheKey?: string;
  userPartitionKey?: string;
};

export class WorkerManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerManifestError";
  }
}

export function validateWorkerManifest(
  input: unknown,
): WorkerManifestValidationResult {
  const parsed = WorkerManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const issues = policyIssuesForWorkerManifest(parsed.data);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, manifest: parsed.data, issues: [] };
}

export function assertWorkerManifest(input: unknown): WorkerManifest {
  const result = validateWorkerManifest(input);
  if (!result.ok) throw new WorkerManifestError(result.issues.join("; "));
  return result.manifest;
}

export function describeWorkerTask<TPayload>(
  manifestInput: unknown,
  options: DescribeWorkerTaskOptions<TPayload>,
): WorkerTaskDescription<TPayload> {
  const manifest = assertWorkerManifest(manifestInput);
  if (
    manifest.kind === "service-worker" &&
    manifest.privacy === "user-private" &&
    manifest.cachePolicy &&
    !options.userPartitionKey
  ) {
    throw new WorkerManifestError(
      `service worker "${manifest.id}" cache for user-private data requires a user partition key`,
    );
  }

  return {
    id: options.id ?? `${manifest.id}:${options.name}`,
    workerId: manifest.id,
    kind: manifest.kind,
    name: options.name,
    privacy: manifest.privacy,
    cancellable: options.cancellable ?? manifest.kind !== "service-worker",
    payload: options.payload,
    traceId: options.traceId,
    cacheKey: options.cacheKey,
  };
}

export function isBrowserWorker(manifestInput: unknown): boolean {
  const manifest = assertWorkerManifest(manifestInput);
  return (
    manifest.kind === "dedicated-worker" ||
    manifest.kind === "shared-worker" ||
    manifest.kind === "service-worker"
  );
}

export function workerRuntimeLabel(manifestInput: unknown): string {
  const manifest = assertWorkerManifest(manifestInput);
  if (manifest.kind === "server-background") return "server background";
  if (manifest.kind === "queue-worker") return "queue worker";
  return manifest.kind.replace("-", " ");
}

export class WorkerTaskCancelledError extends Error {
  constructor(taskId: string) {
    super(`worker task "${taskId}" was cancelled`);
    this.name = "WorkerTaskCancelledError";
  }
}

/**
 * Server-side background task, derived from {@link describeWorkerTask} so the
 * manifest policy checks apply, extended with retry bookkeeping and request
 * correlation (`traceId`/`requestId` propagate from the originating request
 * into every attempt).
 */
export type BackgroundTask<TPayload = unknown> =
  WorkerTaskDescription<TPayload> & {
    requestId?: string;
    attempts: number;
    maxAttempts: number;
  };

export type BackgroundTaskResult = {
  id: string;
  name: string;
  status: "completed" | "dead-letter" | "cancelled";
  attempts: number;
  error?: string;
};

export type DeadLetterEntry<TPayload = unknown> = {
  task: BackgroundTask<TPayload>;
  error: string;
};

export type BackgroundWorkerOptions<TPayload = unknown> = {
  handler: (task: BackgroundTask<TPayload>) => unknown | Promise<unknown>;
  /** Max simultaneously running tasks. Defaults to 1. */
  concurrency?: number;
  /** Total attempts per task (1 = no retry). Defaults to 1. */
  maxAttempts?: number;
  /** Delay before retry, fixed or per-attempt (attempt is 1-based). */
  backoffMs?: number | ((attempt: number) => number);
};

export type EnqueueTaskInput<TPayload = unknown> = {
  name: string;
  payload: TPayload;
  id?: string;
  traceId?: string;
  requestId?: string;
  maxAttempts?: number;
};

export type BackgroundWorker<TPayload = unknown> = {
  manifest: WorkerManifest;
  enqueue: (input: EnqueueTaskInput<TPayload>) => {
    id: string;
    completion: Promise<BackgroundTaskResult>;
  };
  stats: () => { queued: number; running: number; deadLetters: number };
  deadLetters: () => ReadonlyArray<DeadLetterEntry<TPayload>>;
  /** Resolves once every accepted task has settled. */
  drain: () => Promise<void>;
  /** Graceful stop: waits for running tasks, cancels queued/retrying ones. */
  stop: () => Promise<void>;
};

/**
 * In-process task queue for `server-background` / `queue-worker` manifests
 * with a concurrency limit, retry with backoff, a dead-letter queue, and
 * trace propagation. Tasks never reject their completion promise; failures
 * surface as `dead-letter` results.
 */
export function createBackgroundWorker<TPayload = unknown>(
  manifestInput: unknown,
  options: BackgroundWorkerOptions<TPayload>,
): BackgroundWorker<TPayload> {
  const manifest = assertWorkerManifest(manifestInput);
  if (
    manifest.kind !== "server-background" &&
    manifest.kind !== "queue-worker"
  ) {
    throw new WorkerManifestError(
      `worker "${manifest.id}" kind "${manifest.kind}" cannot run as a server background worker`,
    );
  }

  const concurrency = options.concurrency ?? 1;
  const defaultMaxAttempts = options.maxAttempts ?? 1;
  const backoffMs = options.backoffMs ?? 0;

  type QueueEntry = {
    task: BackgroundTask<TPayload>;
    settle: (result: BackgroundTaskResult) => void;
  };

  const queue: QueueEntry[] = [];
  const retryTimers = new Map<QueueEntry, ReturnType<typeof setTimeout>>();
  const deadLetterEntries: DeadLetterEntry<TPayload>[] = [];
  const idleWaiters: Array<() => void> = [];
  let running = 0;
  let pendingCount = 0;
  let stopped = false;
  let sequence = 0;

  function delayForAttempt(attempt: number): number {
    return typeof backoffMs === "function" ? backoffMs(attempt) : backoffMs;
  }

  function settleEntry(entry: QueueEntry, result: BackgroundTaskResult) {
    pendingCount -= 1;
    entry.settle(result);
    if (pendingCount === 0) {
      for (const resolve of idleWaiters.splice(0)) resolve();
    }
  }

  function schedule() {
    while (!stopped && running < concurrency && queue.length > 0) {
      const entry = queue.shift();
      if (!entry) break;
      running += 1;
      void runEntry(entry);
    }
  }

  async function runEntry(entry: QueueEntry) {
    entry.task.attempts += 1;
    try {
      await options.handler(entry.task);
      running -= 1;
      settleEntry(entry, {
        id: entry.task.id,
        name: entry.task.name,
        status: "completed",
        attempts: entry.task.attempts,
      });
    } catch (error) {
      running -= 1;
      const message = error instanceof Error ? error.message : String(error);
      if (stopped || entry.task.attempts >= entry.task.maxAttempts) {
        deadLetterEntries.push({ task: entry.task, error: message });
        settleEntry(entry, {
          id: entry.task.id,
          name: entry.task.name,
          status: "dead-letter",
          attempts: entry.task.attempts,
          error: message,
        });
      } else {
        const timer = setTimeout(() => {
          retryTimers.delete(entry);
          queue.push(entry);
          schedule();
        }, delayForAttempt(entry.task.attempts));
        retryTimers.set(entry, timer);
      }
    }
    schedule();
  }

  function cancelEntry(entry: QueueEntry) {
    settleEntry(entry, {
      id: entry.task.id,
      name: entry.task.name,
      status: "cancelled",
      attempts: entry.task.attempts,
    });
  }

  function waitForIdle(): Promise<void> {
    if (pendingCount === 0) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  return {
    manifest,
    enqueue(input) {
      if (stopped) {
        throw new WorkerManifestError(
          `worker "${manifest.id}" is stopped and cannot accept tasks`,
        );
      }
      sequence += 1;
      const description = describeWorkerTask<TPayload>(manifest, {
        id: input.id ?? `${manifest.id}:${input.name}:${sequence}`,
        name: input.name,
        payload: input.payload,
        traceId: input.traceId,
      });
      const task: BackgroundTask<TPayload> = {
        ...description,
        requestId: input.requestId,
        attempts: 0,
        maxAttempts: input.maxAttempts ?? defaultMaxAttempts,
      };
      pendingCount += 1;
      let settle: (result: BackgroundTaskResult) => void = () => undefined;
      const completion = new Promise<BackgroundTaskResult>((resolve) => {
        settle = resolve;
      });
      queue.push({ task, settle });
      schedule();
      return { id: task.id, completion };
    },
    stats() {
      return {
        queued: queue.length + retryTimers.size,
        running,
        deadLetters: deadLetterEntries.length,
      };
    },
    deadLetters() {
      return [...deadLetterEntries];
    },
    drain: waitForIdle,
    async stop() {
      stopped = true;
      for (const [entry, timer] of retryTimers.entries()) {
        clearTimeout(timer);
        cancelEntry(entry);
      }
      retryTimers.clear();
      for (const entry of queue.splice(0)) cancelEntry(entry);
      await waitForIdle();
    },
  };
}

/** Injectable interval clock so scheduled jobs are testable with fake time. */
export type SchedulerClock = {
  setInterval: (callback: () => void, intervalMs: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

const defaultSchedulerClock: SchedulerClock = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};

export type ScheduledJobOptions = {
  id: string;
  intervalMs: number;
  handler: (run: { runCount: number }) => unknown | Promise<unknown>;
  clock?: SchedulerClock;
  onError?: (error: unknown) => void;
};

export type ScheduledJob = {
  id: string;
  start: () => void;
  stop: () => void;
  readonly running: boolean;
  readonly runCount: number;
};

/**
 * Fixed-interval scheduled job. Overlapping runs are skipped: a tick is
 * ignored while the previous handler invocation is still in flight.
 */
export function createScheduledJob(options: ScheduledJobOptions): ScheduledJob {
  const clock = options.clock ?? defaultSchedulerClock;
  let handle: unknown;
  let inFlight = false;
  let runCount = 0;

  async function tick() {
    if (inFlight) return;
    inFlight = true;
    runCount += 1;
    try {
      await options.handler({ runCount });
    } catch (error) {
      options.onError?.(error);
    } finally {
      inFlight = false;
    }
  }

  return {
    id: options.id,
    start() {
      if (handle !== undefined) return;
      handle = clock.setInterval(() => void tick(), options.intervalMs);
    },
    stop() {
      if (handle === undefined) return;
      clock.clearInterval(handle);
      handle = undefined;
    },
    get running() {
      return handle !== undefined;
    },
    get runCount() {
      return runCount;
    },
  };
}

/**
 * Typed postMessage protocol between the worker client and host:
 * `request` (client -> worker), `response` (worker -> client), and
 * `cancel` (client -> worker).
 */
export type WorkerRequestMessage<TPayload = unknown> = {
  type: "request";
  taskId: string;
  name: string;
  payload: TPayload;
  traceId?: string;
};

export type WorkerResponseMessage<TResult = unknown> =
  | { type: "response"; taskId: string; ok: true; result: TResult }
  | { type: "response"; taskId: string; ok: false; error: string };

export type WorkerCancelMessage = {
  type: "cancel";
  taskId: string;
};

export type WorkerProtocolMessage<TPayload = unknown, TResult = unknown> =
  | WorkerRequestMessage<TPayload>
  | WorkerResponseMessage<TResult>
  | WorkerCancelMessage;

/** Structural Worker surface so tests and demos can inject a mock. */
export type WorkerLike = {
  postMessage: (message: unknown) => void;
  addEventListener: (
    type: "message",
    listener: (event: { data: unknown }) => void,
  ) => void;
  terminate?: () => void;
};

export type WorkerClientRunOptions = {
  traceId?: string;
  cancellable?: boolean;
};

export type WorkerClientTask<TResult = unknown> = {
  taskId: string;
  result: Promise<TResult>;
  cancel: () => void;
};

export type WorkerClient<TPayload = unknown, TResult = unknown> = {
  manifest: WorkerManifest;
  run: (
    name: string,
    payload: TPayload,
    options?: WorkerClientRunOptions,
  ) => WorkerClientTask<TResult>;
  terminate: () => void;
};

/**
 * Typed wrapper around a browser worker. The Worker constructor is injected
 * so tests can substitute a mock; tasks follow the request/response/cancel
 * protocol and respect the manifest's cancellability rules.
 */
export function createWorkerClient<TPayload = unknown, TResult = unknown>(
  manifestInput: unknown,
  { createWorker }: { createWorker: () => WorkerLike },
): WorkerClient<TPayload, TResult> {
  const manifest = assertWorkerManifest(manifestInput);
  if (!isBrowserWorker(manifest)) {
    throw new WorkerManifestError(
      `worker "${manifest.id}" kind "${manifest.kind}" cannot run in the browser`,
    );
  }

  type PendingTask = {
    resolve: (result: TResult) => void;
    reject: (error: Error) => void;
  };

  const worker = createWorker();
  const pending = new Map<string, PendingTask>();
  let sequence = 0;

  worker.addEventListener("message", (event) => {
    const message = event.data as WorkerResponseMessage<TResult> | undefined;
    if (message?.type !== "response") return;
    const entry = pending.get(message.taskId);
    if (!entry) return;
    pending.delete(message.taskId);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error));
  });

  return {
    manifest,
    run(name, payload, options = {}) {
      sequence += 1;
      const task = describeWorkerTask<TPayload>(manifest, {
        id: `${manifest.id}:${name}:${sequence}`,
        name,
        payload,
        traceId: options.traceId,
        cancellable: options.cancellable,
      });
      const result = new Promise<TResult>((resolve, reject) => {
        pending.set(task.id, { resolve, reject });
      });
      const request: WorkerRequestMessage<TPayload> = {
        type: "request",
        taskId: task.id,
        name: task.name,
        payload: task.payload,
        traceId: task.traceId,
      };
      worker.postMessage(request);
      return {
        taskId: task.id,
        result,
        cancel() {
          if (!task.cancellable) {
            throw new WorkerManifestError(
              `worker task "${task.id}" is not cancellable`,
            );
          }
          const entry = pending.get(task.id);
          if (!entry) return;
          pending.delete(task.id);
          const cancelMessage: WorkerCancelMessage = {
            type: "cancel",
            taskId: task.id,
          };
          worker.postMessage(cancelMessage);
          entry.reject(new WorkerTaskCancelledError(task.id));
        },
      };
    },
    terminate() {
      for (const [taskId, entry] of pending.entries()) {
        entry.reject(new WorkerTaskCancelledError(taskId));
      }
      pending.clear();
      worker.terminate?.();
    },
  };
}

/** Structural worker global scope (self) so hosts are testable in Node. */
export type WorkerHostScope = {
  postMessage: (message: unknown) => void;
  addEventListener: (
    type: "message",
    listener: (event: { data: unknown }) => void,
  ) => void;
};

export type WorkerHostHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  context: {
    taskId: string;
    name: string;
    traceId?: string;
    signal: AbortSignal;
  },
) => TResult | Promise<TResult>;

/**
 * Worker-side counterpart of {@link createWorkerClient}: dispatches request
 * messages to named handlers, posts responses, and aborts the handler's
 * AbortSignal when a cancel message arrives.
 */
export function createWorkerHost<TPayload = unknown, TResult = unknown>(
  scope: WorkerHostScope,
  handlers: Record<string, WorkerHostHandler<TPayload, TResult>>,
): void {
  const controllers = new Map<string, AbortController>();

  scope.addEventListener("message", (event) => {
    const message = event.data as WorkerProtocolMessage<TPayload, TResult>;
    if (!message || typeof message !== "object") return;

    if (message.type === "cancel") {
      controllers.get(message.taskId)?.abort();
      controllers.delete(message.taskId);
      return;
    }

    if (message.type !== "request") return;
    const handler = handlers[message.name];
    if (!handler) {
      scope.postMessage({
        type: "response",
        taskId: message.taskId,
        ok: false,
        error: `no handler registered for task "${message.name}"`,
      } satisfies WorkerResponseMessage<TResult>);
      return;
    }

    const controller = new AbortController();
    controllers.set(message.taskId, controller);
    void (async () => {
      try {
        const result = await handler(message.payload, {
          taskId: message.taskId,
          name: message.name,
          traceId: message.traceId,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          scope.postMessage({
            type: "response",
            taskId: message.taskId,
            ok: true,
            result,
          } satisfies WorkerResponseMessage<TResult>);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          scope.postMessage({
            type: "response",
            taskId: message.taskId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } satisfies WorkerResponseMessage<TResult>);
        }
      } finally {
        controllers.delete(message.taskId);
      }
    })();
  });
}

function policyIssuesForWorkerManifest(manifest: WorkerManifest): string[] {
  const issues: string[] = [];

  if (manifest.kind === "service-worker" && !manifest.scope) {
    issues.push(`service worker "${manifest.id}" must declare scope`);
  }

  if (
    manifest.kind === "service-worker" &&
    manifest.privacy === "user-private" &&
    manifest.cachePolicy?.ttl
  ) {
    issues.push(
      `service worker "${manifest.id}" cannot ttl-cache user-private data by default`,
    );
  }

  if (
    (manifest.kind === "server-background" ||
      manifest.kind === "queue-worker") &&
    manifest.scope
  ) {
    issues.push(`${manifest.kind} "${manifest.id}" must not declare scope`);
  }

  return issues;
}
