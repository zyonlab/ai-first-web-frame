# @mvp/observability — AGENT.md

## What this package is for

`@mvp/observability` provides the framework's tracing and metrics primitives:
an in-process span tree (`RequestTrace`) that `@mvp/runtime` and `@mvp/request`
write spans into during one request's lifecycle, a Prometheus-compatible
metrics registry, and exporters that turn a finished trace into JSONL files,
stdout JSON lines, or an OTLP/JSON HTTP payload. It has no dependency on any
other `@mvp/*` package. Nothing in this package throws to signal "no exporter
configured" — trace creation and span recording always work standalone
in-memory; export is opt-in via `configureTraceExport`.

## Entry points

- `createRequestTrace(options: { traceId: string, requestId?: string, now?: () => number }): RequestTrace`
  — the entry point for tracing one request. Returns
  `{ traceId, startSpan(name, kind?, opts?): spanId, endSpan(spanId, opts?): void, addDependency(from, to, type?): void, toJSON(): RequestTraceSnapshot, toDependencyGraphLog(): string }`.
  `kind` is one of `"request"|"scheduler"|"fragment"|"network"|"cache"|"static"|"data"|"custom"`.
  Pass the resulting trace into `@mvp/runtime`'s `executeFragmentSlots({ trace })`
  or `@mvp/request`'s `createRequestClient({ trace })`.
- `createMetricsRegistry(): MetricsRegistry` — creates an isolated counter/
  gauge/histogram registry with `createCounter/createGauge/createHistogram`,
  `toPrometheusText(): string`, `toJSON(): MetricsSnapshot`, and `reset()`.
  `createHttpMetrics(registry)` and `recordWebVital(registry, input)` are
  ready-made helpers built on top of it for the two most common series
  (`http_requests_total`/`http_request_duration_seconds`, and
  `web_vitals_{lcp,inp,cls,ttfb}`).
- `configureTraceExport(pipeline: TraceExportPipeline): void` /
  `exportTrace(trace: RequestTrace | RequestTraceSnapshot): Promise<boolean>` —
  install a pipeline (`{ exporters: TraceExporter[], sampler?: TraceSampler }`)
  once at process start, then call `exportTrace(trace)` per finished request;
  returns `false` if no pipeline is configured or the sampler dropped the
  trace, `true` once at least one exporter received it.
- `createFileTraceExporter(options?)`, `createConsoleTraceExporter(options?)`,
  `createOtlpJsonTraceExporter(options?)` — the three built-in
  `TraceExporter` factories (JSONL file under `reports/traces/`, stdout JSON
  line, OTLP/JSON HTTP POST respectively). Compose 1+ into a pipeline.
- `toOtlpJsonPayload(snapshot, options?): OtlpJsonTracePayload` — pure mapping
  function from `RequestTraceSnapshot` to the OTLP/JSON HTTP shape; useful for
  testing exporter output without a network call.

## Error taxonomy

This package intentionally avoids throwing from the hot tracing path — a
misused span id is a silent no-op (`endSpan` on an unknown or
already-ended `spanId` returns without effect) so instrumentation bugs never
crash the request. It does throw in the metrics registry, which is meant to
fail fast on programmer error at setup time:

- **`Error("invalid metric name: <name>")`** — thrown by
  `createCounter`/`createGauge`/`createHistogram` when `name` does not match
  `^[a-zA-Z_:][a-zA-Z0-9_:]*$` (the Prometheus metric-name grammar).
- **`Error("metric <name> already registered as <type>, cannot reuse as <type>")`**
  — thrown when the same metric name is requested twice with two different
  types (e.g. once as a counter, once as a histogram) on the same registry.
- **`Error("counter <name> cannot decrease")`** — thrown by a `Counter.inc()`
  call with a negative `value`.
- **`Error("metric <name> received a non-finite value: <value>")`** — thrown
  by any `Counter.inc` / `Gauge.set|inc|dec` / `Histogram.observe` call with a
  `NaN` or `Infinity` value.
- **`Error("histogram <name> requires finite bucket bounds")`** — thrown by
  `createHistogram` if the resolved `buckets` array is empty or contains a
  non-finite bound after dedup/sort.
- **`Error("unknown web vital: <name>")`** — thrown by `recordWebVital` if
  `input.name` is not one of `"LCP"|"INP"|"CLS"|"TTFB"`.
- Exporter failures (`createFileTraceExporter`, `createOtlpJsonTraceExporter`)
  never throw synchronously — write/network errors are routed to the
  exporter's `onError` callback (default: `console.error`) so one exporter
  failure never blocks others in the same pipeline.

## Example

```ts
import {
  createRequestTrace,
  createMetricsRegistry,
  createHttpMetrics,
  configureTraceExport,
  createConsoleTraceExporter,
  exportTrace,
} from "@mvp/observability";

configureTraceExport({ exporters: [createConsoleTraceExporter()] });

const trace = createRequestTrace({ traceId: "trace-abc123", requestId: "req-1" });
const spanId = trace.startSpan("fragment.http:price-panel", "network", {
  attributes: { serviceUrl: "http://localhost:4203" },
});
trace.endSpan(spanId, { status: "ok" });
await exportTrace(trace); // prints one JSON line to stdout

const metrics = createMetricsRegistry();
const http = createHttpMetrics(metrics);
http.recordRequest({ method: "GET", route: "/render", statusCode: 200, durationMs: 42 });
console.log(metrics.toPrometheusText());
```

## Accept

```
pnpm --filter @mvp/observability test
```
Expected: Vitest exits 0. Covers `packages/observability/src/index.test.ts`
(span tree + dependency graph), `metrics.test.ts` (registry error cases,
Prometheus text format), and `traceExport.test.ts` (sampler determinism, file/
console/OTLP exporter behavior).
