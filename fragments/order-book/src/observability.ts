import {
  configureTraceExport,
  createConsoleTraceExporter,
  createFileTraceExporter,
  createHttpMetrics,
  createMetricsRegistry,
  createTraceSampler,
  type Histogram,
  type HttpMetrics,
  type MetricsRegistry,
} from "@mvp/observability";

export const SERVICE_NAME = "order-book";

export type FragmentObservability = {
  registry: MetricsRegistry;
  http: HttpMetrics;
  /** Dedicated /render latency histogram feeding the p95 analysis template. */
  renderDuration: Histogram;
};

/**
 * Builds a process-scoped metrics registry plus the HTTP recorder and a
 * dedicated render-latency histogram. Buckets are tuned to the realtime
 * fragment latency budget (120ms) so K8s/Argo p95 queries land on meaningful
 * bounds for the order book.
 */
export function createFragmentObservability(): FragmentObservability {
  const registry = createMetricsRegistry();
  const http = createHttpMetrics(registry);
  const renderDuration = registry.createHistogram(
    "fragment_render_duration_seconds",
    {
      help: "SSR /render duration in seconds.",
      buckets: [0.002, 0.005, 0.01, 0.02, 0.04, 0.06, 0.1, 0.12, 0.2, 0.5],
    },
  );
  return { registry, http, renderDuration };
}

let traceExportConfigured = false;

/**
 * Installs the global trace export pipeline once per process: a file exporter
 * (JSONL under reports/traces) and a console exporter, with a sampler whose
 * rate is read from TRACE_SAMPLE_RATE (defaults to 1 = always sample).
 */
export function configureFragmentTraceExport(): void {
  if (traceExportConfigured) return;
  traceExportConfigured = true;
  const rate = Number(process.env.TRACE_SAMPLE_RATE ?? "1");
  configureTraceExport({
    exporters: [
      createFileTraceExporter({ serviceName: SERVICE_NAME }),
      createConsoleTraceExporter(),
    ],
    sampler: createTraceSampler({ rate: Number.isFinite(rate) ? rate : 1 }),
  });
}
