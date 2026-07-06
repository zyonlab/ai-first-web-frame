import type { WorkerManifest } from "@mvp/contracts";
import {
  type BackgroundTask,
  type BackgroundTaskResult,
  type BackgroundWorker,
  createBackgroundWorker,
} from "@mvp/workers";

/**
 * `server-background` worker that warms product statistics/recommendations
 * off the request path. It runs in-process, so it must be a module-level
 * singleton (created once per server process) rather than per request.
 */
export const productStatsWorkerManifest: WorkerManifest = {
  id: "product-stats-warmer",
  kind: "server-background",
  privacy: "tenant",
};

export type ProductStatsPayload = {
  productId: string;
  tenant: string;
  /** Correlation ids propagated from the originating request. */
  traceId: string;
  requestId: string;
};

export type ProductStatsResult = {
  productId: string;
  recomputedAtMs: number;
  /** Echoed back so the demo can prove trace propagation into the worker. */
  traceId: string;
  requestId: string;
};

/** Records the last computed result per task id for display on the page. */
const computedResults = new Map<string, ProductStatsResult>();

async function warmProductStats(
  task: BackgroundTask<ProductStatsPayload>,
  now: () => number,
): Promise<ProductStatsResult> {
  const result: ProductStatsResult = {
    productId: task.payload.productId,
    recomputedAtMs: now(),
    // Trace ids arrive both on the enqueue envelope and inside the payload;
    // reading them from the task proves end-to-end propagation.
    traceId: task.traceId ?? task.payload.traceId,
    requestId: task.requestId ?? task.payload.requestId,
  };
  computedResults.set(task.id, result);
  return result;
}

let workerSingleton: BackgroundWorker<ProductStatsPayload> | undefined;

/** Lazily creates (once) and returns the process-wide background worker. */
export function getProductStatsWorker(now: () => number = Date.now) {
  if (!workerSingleton) {
    workerSingleton = createBackgroundWorker<ProductStatsPayload>(
      productStatsWorkerManifest,
      {
        handler: (task) => warmProductStats(task, now),
        concurrency: 2,
        maxAttempts: 2,
      },
    );
  }
  return workerSingleton;
}

/** Test-only reset so fake-timer suites start from a clean singleton. */
export function resetProductStatsWorker() {
  workerSingleton = undefined;
  computedResults.clear();
}

export function getComputedResult(taskId: string) {
  return computedResults.get(taskId);
}

export type EnqueueProductStatsInput = {
  productId: string;
  tenant: string;
  traceId: string;
  requestId: string;
  now?: () => number;
};

export type EnqueuedProductStats = {
  taskId: string;
  completion: Promise<BackgroundTaskResult>;
};

/**
 * Enqueues a "recompute product stats / warm recommendations" job for the
 * current request, propagating its trace and request ids for correlation.
 */
export function enqueueProductStatsJob({
  productId,
  tenant,
  traceId,
  requestId,
  now = Date.now,
}: EnqueueProductStatsInput): EnqueuedProductStats {
  const worker = getProductStatsWorker(now);
  const { id, completion } = worker.enqueue({
    name: "recompute-product-stats",
    payload: { productId, tenant, traceId, requestId },
    traceId,
    requestId,
  });
  return { taskId: id, completion };
}
