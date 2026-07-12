# @mvp/workers — AGENT.md

## What this package is for

`@mvp/workers` is the manifest-governed worker runtime layer: every worker —
browser (`dedicated-worker` / `shared-worker` / `service-worker`) or
server-side (`server-background` / `queue-worker`) — is declared by a
`WorkerManifest` (Zod schema in `@mvp/contracts`) and validated with extra
policy rules before anything runs. On top of that it provides an in-process
background task queue (concurrency limit, retry with backoff, dead-letter
queue, trace propagation), a fixed-interval scheduled job with an injectable
clock, and a typed `postMessage` request/response/cancel protocol between a
worker client and host. Every runtime dependency (Worker constructor, worker
global scope, interval clock) is injected, so all of it is testable in plain
Node with no browser.

## Entry points

- `validateWorkerManifest(input: unknown): WorkerManifestValidationResult` —
  `WorkerManifestSchema.safeParse` plus policy rules; returns
  `{ ok: true, manifest, issues: [] }` or `{ ok: false, issues: string[] }`
  (never throws). Policy rules: a `service-worker` must declare `scope`; a
  `service-worker` with `privacy: "user-private"` must not ttl-cache;
  `server-background`/`queue-worker` must not declare `scope`.
- `assertWorkerManifest(input: unknown): WorkerManifest` — same checks,
  throws `WorkerManifestError` with the joined issues.
- `describeWorkerTask<TPayload>(manifestInput, options: { name, payload, id?, traceId?, cancellable?, cacheKey?, userPartitionKey? }): WorkerTaskDescription<TPayload>`
  — validates the manifest and derives a task description
  (`id` defaults to `"<workerId>:<name>"`; `cancellable` defaults to `true`
  except for `service-worker`). Throws `WorkerManifestError` when a
  `service-worker` with `user-private` privacy and a `cachePolicy` is used
  without a `userPartitionKey`.
- `isBrowserWorker(manifestInput): boolean` / `workerRuntimeLabel(manifestInput): string`
  — kind classification helpers (both validate first).
- `createBackgroundWorker<TPayload>(manifestInput, options: { handler, concurrency? = 1, maxAttempts? = 1, backoffMs? = 0 }): BackgroundWorker<TPayload>`
  — in-process queue for `server-background`/`queue-worker` manifests only.
  `enqueue({ name, payload, id?, traceId?, requestId?, maxAttempts? })`
  returns `{ id, completion: Promise<BackgroundTaskResult> }`; the completion
  promise **never rejects** — failures surface as
  `status: "dead-letter"` results (with `attempts` and `error`), cancellation
  as `"cancelled"`. `stats()` → `{ queued, running, deadLetters }`;
  `deadLetters()` returns the entries; `drain()` resolves once every accepted
  task settled; `stop()` waits for running tasks and cancels queued/retrying
  ones (after `stop()`, `enqueue` throws).
- `createScheduledJob(options: { id, intervalMs, handler, clock?, onError? }): ScheduledJob`
  — fixed-interval job (`start`/`stop`, `running`, `runCount`); overlapping
  ticks are skipped while a handler run is in flight; handler errors go to
  `onError`, never unhandled. `clock: SchedulerClock` makes it fake-time
  testable.
- `createWorkerClient<TPayload, TResult>(manifestInput, { createWorker: () => WorkerLike }): WorkerClient`
  — typed wrapper for browser-worker kinds (throws `WorkerManifestError` for
  server kinds). `run(name, payload, options?)` returns
  `{ taskId, result: Promise<TResult>, cancel() }`; `cancel()` throws
  `WorkerManifestError` if the task isn't cancellable, otherwise posts a
  cancel message and rejects `result` with `WorkerTaskCancelledError`.
  `terminate()` rejects all in-flight tasks and terminates the worker.
- `createWorkerHost<TPayload, TResult>(scope: WorkerHostScope, handlers: Record<string, WorkerHostHandler>): void`
  — the worker-side counterpart: dispatches `request` messages to named
  handlers (each gets `{ taskId, name, traceId?, signal: AbortSignal }`),
  posts `response` messages, aborts the handler's signal on `cancel`, and
  answers unknown task names with an error response.
- Protocol/types: `WorkerRequestMessage` / `WorkerResponseMessage` /
  `WorkerCancelMessage`, `WorkerLike`, `WorkerHostScope`, `BackgroundTask`,
  `BackgroundTaskResult`, `DeadLetterEntry`, `SchedulerClock`.

## Error taxonomy

- **`WorkerManifestError`** — thrown for: an invalid manifest
  (schema or policy issues, via `assertWorkerManifest`), running a manifest
  on the wrong side (`createBackgroundWorker` with a browser kind,
  `createWorkerClient` with a server kind), enqueueing on a stopped worker,
  cancelling a non-cancellable task, and the missing-`userPartitionKey`
  cache rule in `describeWorkerTask`.
- **`WorkerTaskCancelledError`** (`worker task "<id>" was cancelled`) — the
  rejection reason of a worker-client task's `result` after `cancel()` or
  `terminate()`.
- **Never-throwing surfaces**: `validateWorkerManifest` reports issues
  in-band; a background task's `completion` never rejects (`dead-letter` /
  `cancelled` results instead); scheduled-job handler errors go to `onError`.

## Example

```ts
import {
  createBackgroundWorker,
  createWorkerClient,
  createWorkerHost,
  describeWorkerTask,
  validateWorkerManifest,
  type WorkerHostScope,
  type WorkerLike,
} from "@mvp/workers";

// Policy validation is in-band and never throws.
const invalid = validateWorkerManifest({ id: "sw-cache", kind: "service-worker" });
if (invalid.ok || !invalid.issues[0].includes("must declare scope"))
  throw new Error("service worker without scope must be rejected");

const queueManifest = { id: "report-builder", kind: "server-background" };
const task = describeWorkerTask(queueManifest, { name: "build", payload: { week: 27 } });
if (task.id !== "report-builder:build" || !task.cancellable)
  throw new Error("task defaults");
if (task.privacy !== "public") throw new Error("privacy defaults to public");

// Background queue: retry with (zero) backoff, then dead-letter bookkeeping.
let calls = 0;
const worker = createBackgroundWorker(queueManifest, {
  handler: (t) => {
    if (t.name === "flaky" && ++calls < 2) throw new Error("transient");
    if (t.name === "doomed") throw new Error("permanent");
  },
  maxAttempts: 2,
  backoffMs: 0,
});
const flaky = await worker.enqueue({ name: "flaky", payload: {} }).completion;
if (flaky.status !== "completed" || flaky.attempts !== 2)
  throw new Error("must retry then complete");
const doomed = await worker.enqueue({ name: "doomed", payload: {} }).completion;
if (doomed.status !== "dead-letter" || doomed.error !== "permanent")
  throw new Error("exhausted task must dead-letter, not reject");
if (worker.stats().deadLetters !== 1) throw new Error("dead-letter count");
await worker.stop();

// Client <-> host round trip over the typed protocol, no real Worker needed.
const toWorker: Array<(e: { data: unknown }) => void> = [];
const toClient: Array<(e: { data: unknown }) => void> = [];
const scope: WorkerHostScope = {
  postMessage: (m) => toClient.forEach((l) => l({ data: m })),
  addEventListener: (_t, l) => toWorker.push(l),
};
const fakeWorker: WorkerLike = {
  postMessage: (m) => toWorker.forEach((l) => l({ data: m })),
  addEventListener: (_t, l) => toClient.push(l),
};
createWorkerHost<{ size: number }, number>(scope, {
  resize: (payload) => payload.size * 2,
});
const client = createWorkerClient<{ size: number }, number>(
  { id: "image-tools", kind: "dedicated-worker" },
  { createWorker: () => fakeWorker },
);
const run = client.run("resize", { size: 21 });
if ((await run.result) !== 42) throw new Error("host handler result");
client.terminate();
```

## Accept

```
pnpm --filter @mvp/workers test
```
Expected: Vitest exits 0. `packages/workers/src/index.test.ts` covers manifest
validation + policy issues, task description rules (cancellability, the
user-partition cache rule), the background queue (concurrency, retry/backoff,
dead-letter, graceful stop), scheduled jobs (overlap skipping, injected
clock), and the client/host protocol (responses, error responses, cancel
abort, terminate).
