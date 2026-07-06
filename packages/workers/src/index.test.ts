import { describe, expect, it } from "vitest";
import {
  assertWorkerManifest,
  describeWorkerTask,
  isBrowserWorker,
  validateWorkerManifest,
  WorkerManifestError,
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
