/**
 * @mvp/fragment-host — the one HTTP host every SSR fragment service runs on.
 *
 * Before this package each of the 14 fragments carried its own ~130-line
 * `src/server.ts` plus a ~58-line `src/observability.ts`; two randomly picked
 * copies differed by 28 lines, all of them name/port/render-function noise.
 * Changing the fragment HTTP contract therefore meant 14 edits, and the copies
 * had already drifted (metric hook placement, comments). Worse, the drift was
 * invisible to `pnpm audit:similarity`, which only fingerprints `.tsx`.
 *
 * The contract this host owns, identically for every fragment:
 *
 * | Route            | Behavior                                                |
 * | ---------------- | ------------------------------------------------------- |
 * | `GET /`          | Browser-readable demo page rendering `options.demo`     |
 * | `GET /health`    | `{status, service, version, uptimeMs}` — dependency free |
 * | `GET /ready`     | Same shape; separate probe target for rollout systems   |
 * | `GET /metrics`   | Prometheus text exposition                               |
 * | `GET /manifest`  | The fragment manifest verbatim                           |
 * | `GET /assets`    | `manifest.assets` verbatim                               |
 * | `GET /budget`    | The fragment budget verbatim                             |
 * | `POST /render`   | `parseFragmentRenderRequest` → render → trace + metrics  |
 *
 * `/health` and `/ready` carry the manifest `version`, which is what makes a
 * fragment independently deployable in practice: a deployment system can
 * confirm WHICH version answered before promoting that version's registry
 * channel (`scripts/promote-fragment.mts`).
 */

import { pathToFileURL } from "node:url";
import { parseFragmentRenderRequest } from "@mvp/contracts";
import {
  configureTraceExport,
  createConsoleTraceExporter,
  createFileTraceExporter,
  createHttpMetrics,
  createMetricsRegistry,
  createRequestTrace,
  createTraceSampler,
  exportTrace,
  type Histogram,
  type HttpMetrics,
  type MetricsRegistry,
  type RequestTrace,
} from "@mvp/observability";
import Fastify, { type FastifyInstance } from "fastify";

/** Content-Type Prometheus scrapers expect for the text exposition format. */
export const PROMETHEUS_CONTENT_TYPE =
  "text/plain; version=0.0.4; charset=utf-8";

/** Probe/scrape routes kept out of HTTP metrics so they never skew p95. */
const UNINSTRUMENTED_ROUTES = new Set(["/metrics", "/health", "/ready"]);

export type FragmentObservability = {
  registry: MetricsRegistry;
  http: HttpMetrics;
  /** Dedicated /render latency histogram feeding the p95 analysis template. */
  renderDuration: Histogram;
};

/**
 * Builds a process-scoped metrics registry plus the HTTP recorder and a
 * dedicated render-latency histogram. Buckets are tuned to the 200ms fragment
 * latency budget so k8s/Argo p95 queries land on meaningful bounds.
 */
export function createFragmentObservability(): FragmentObservability {
  const registry = createMetricsRegistry();
  const http = createHttpMetrics(registry);
  const renderDuration = registry.createHistogram(
    "fragment_render_duration_seconds",
    {
      help: "SSR /render duration in seconds.",
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1],
    },
  );
  return { registry, http, renderDuration };
}

const traceExportConfigured = new Set<string>();

/**
 * Installs the global trace export pipeline once per process per service.
 * `TRACE_SAMPLE_RATE` overrides the rate (default 1 = always sample).
 */
export function configureFragmentTraceExport(serviceName: string): void {
  if (traceExportConfigured.has(serviceName)) return;
  traceExportConfigured.add(serviceName);
  const rate = Number(process.env.TRACE_SAMPLE_RATE ?? "1");
  configureTraceExport({
    exporters: [
      createFileTraceExporter({ serviceName }),
      createConsoleTraceExporter(),
    ],
    sampler: createTraceSampler({ rate: Number.isFinite(rate) ? rate : 1 }),
  });
}

/** Test hook: forget which services already installed a trace pipeline. */
export function resetFragmentTraceExportState(): void {
  traceExportConfigured.clear();
}

/**
 * Options the host passes into a fragment's render function. `now` is the
 * host's injectable clock, forwarded so a render that derives time-dependent
 * output (market-header's funding countdown) stays deterministic under the
 * same `buildServer({ now })` a test already uses for `/health` uptime.
 */
export type FragmentRenderOptions = {
  trace?: RequestTrace;
  now?: () => number;
};

/** The render entry point every fragment's `src/render.ts` exports. */
export type FragmentRenderFn<TRequest> = (
  request: TRequest,
  options?: FragmentRenderOptions,
) => Promise<{ statusCode: number; body: unknown }>;

/** The manifest fields the host itself reads; fragments pass theirs whole. */
export type FragmentManifestLike = {
  name: string;
  version: string;
  assets: unknown;
};

/** What a fragment's own `buildServer(options)` forwards to the host. */
export type BuildFragmentServerOptions = {
  /** Injectable clock for deterministic uptime in tests. */
  now?: () => number;
  /** Injectable observability, mainly to assert metrics in tests. */
  observability?: FragmentObservability;
};

export type CreateFragmentServerOptions<TRequest> =
  BuildFragmentServerOptions & {
    /** Kebab-case fragment name; the `service` field of /health and metrics. */
    serviceName: string;
    /** Default listen port, shown on the demo page. */
    port: number;
    manifest: FragmentManifestLike;
    budget: unknown;
    render: FragmentRenderFn<TRequest>;
    /** Request used to render the `GET /` demo page. */
    demo: TRequest;
    /** Fragment-specific extra routes (e.g. order-form's island bundle). */
    extraRoutes?: (server: FastifyInstance) => void;
  };

export function createFragmentServer<TRequest>(
  options: CreateFragmentServerOptions<TRequest>,
): FastifyInstance {
  const { serviceName, port, manifest, budget, render, demo, extraRoutes } =
    options;
  const now = options.now ?? Date.now;
  const startedAtMs = now();
  const obs = options.observability ?? createFragmentObservability();

  configureFragmentTraceExport(serviceName);

  const server = Fastify({ logger: false });

  // One HTTP metric sample per handled request. The route label uses the
  // matched route pattern so label cardinality stays bounded.
  server.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions?.url ?? request.url;
    if (UNINSTRUMENTED_ROUTES.has(route)) return;
    obs.http.recordRequest({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs: reply.elapsedTime,
    });
  });

  server.get("/", async (_request, reply) => {
    const result = await render(demo);
    const body = result.body as { html?: string };
    reply.type("text/html; charset=utf-8");
    return renderFragmentServiceHome({
      title: `${serviceName} fragment`,
      version: manifest.version,
      port,
      sampleHtml: typeof body?.html === "string" ? body.html : "",
    });
  });

  const probe = async () => ({
    status: "ok" as const,
    service: serviceName,
    // The deployed version, so a rollout can assert WHICH build answered
    // before promoting this version's registry channel.
    version: manifest.version,
    uptimeMs: now() - startedAtMs,
  });
  server.get("/health", probe);
  server.get("/ready", probe);

  server.get("/metrics", async (_request, reply) => {
    reply.type(PROMETHEUS_CONTENT_TYPE);
    return obs.registry.toPrometheusText();
  });
  server.get("/manifest", async () => manifest);
  server.get("/assets", async () => manifest.assets);
  server.get("/budget", async () => budget);

  server.post("/render", async (request, reply) => {
    const parsed = parseFragmentRenderRequest(request.body);
    if (!parsed.ok) {
      // Malformed envelope: fail loudly with the contract's issues. The
      // onResponse hook records the 400 in the HTTP metrics.
      reply.code(400);
      return {
        error: { code: "invalid-render-request", issues: parsed.issues },
      };
    }
    const body = parsed.request as TRequest;
    const ctx = (parsed.request as { ctx?: { traceId?: string } }).ctx;
    const traceId = ctx?.traceId ?? `trace-${serviceName}-${now()}`;
    const trace = createRequestTrace({ traceId });
    const requestSpan = trace.startSpan("request:/render", "request", {
      attributes: { service: serviceName },
    });

    const startedRenderAtMs = now();
    const result = await render(body, { trace, now });
    obs.renderDuration.observe((now() - startedRenderAtMs) / 1000, {
      route: "/render",
      status: String(result.statusCode),
    });

    trace.endSpan(requestSpan, {
      status: result.statusCode >= 400 ? "error" : "ok",
      attributes: { statusCode: result.statusCode },
    });

    // Fire-and-forget export so a slow sink never blocks the response.
    void exportTrace(trace).catch(() => {
      /* exporters own their error reporting */
    });

    reply.code(result.statusCode);
    return result.body;
  });

  extraRoutes?.(server);

  return server;
}

/** The `GET /` demo page: endpoint index plus one live sample render. */
export function renderFragmentServiceHome({
  title,
  version,
  port,
  sampleHtml,
}: {
  title: string;
  version: string;
  port: number;
  sampleHtml: string;
}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui,sans-serif;margin:32px;line-height:1.5}main{max-width:760px}code{background:#f2f2f2;padding:2px 5px;border-radius:4px}section{margin:20px 0;padding:16px;border:1px solid #ddd}</style></head><body><main data-fragment-service="${title}" data-fragment-version="${version}"><h1>${title}</h1><p>This port serves an independently deployable SSR fragment service, version <code>${version}</code>.</p><ul><li><a href="/health">/health</a></li><li><a href="/ready">/ready</a></li><li><a href="/metrics">/metrics</a></li><li><a href="/manifest">/manifest</a></li><li><a href="/assets">/assets</a></li><li><a href="/budget">/budget</a></li><li><code>POST http://localhost:${port}/render</code></li></ul><h2>Sample render</h2>${sampleHtml}</main></body></html>`;
}

/**
 * Binds a built server to `PORT` (falling back to the fragment's default) —
 * the body of every fragment's `import.meta.url === argv[1]` entry block.
 */
export async function startFragmentServer(
  server: FastifyInstance,
  { serviceName, port }: { serviceName: string; port: number },
): Promise<void> {
  const listenPort = Number(process.env.PORT ?? port);
  await server.listen({ host: "0.0.0.0", port: listenPort });
  console.log(`${serviceName} listening on ${listenPort}`);
}

/** True when this module's importer is the process entry point. */
export function isProcessEntry(importMetaUrl: string): boolean {
  return Boolean(
    process.argv[1] && importMetaUrl === pathToFileURL(process.argv[1]).href,
  );
}
