import { pathToFileURL } from "node:url";
import { createRequestTrace, exportTrace } from "@mvp/observability";
import Fastify from "fastify";
import { portfolioSummaryBudget } from "./budget";
import { portfolioSummaryManifest } from "./manifest";
import {
  configureFragmentTraceExport,
  createFragmentObservability,
  type FragmentObservability,
  SERVICE_NAME,
} from "./observability";
import { renderPortfolioSummary } from "./render";

export type BuildServerOptions = {
  /** Injectable clock for deterministic uptime in tests. */
  now?: () => number;
  /** Injectable observability, mainly to assert metrics in tests. */
  observability?: FragmentObservability;
};

/** Routes excluded from HTTP metrics to keep scrape/health noise out of p95. */
const UNINSTRUMENTED_ROUTES = new Set(["/metrics", "/health"]);

const DEFAULT_PORT = 4213;

export function buildServer(options: BuildServerOptions = {}) {
  const now = options.now ?? Date.now;
  const startedAtMs = now();
  const obs = options.observability ?? createFragmentObservability();

  configureFragmentTraceExport();

  const server = Fastify({ logger: false });

  // Record one HTTP metric sample per handled request. The route label uses the
  // matched route pattern so cardinality stays bounded.
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
    const demo = await renderPortfolioSummary({ ctx: { locale: "en-US" } });
    reply.type("text/html; charset=utf-8");
    return renderServiceHome({
      title: "portfolio-summary fragment",
      port: DEFAULT_PORT,
      sampleHtml: "html" in demo.body ? demo.body.html : "",
    });
  });
  server.get("/health", async () => ({
    status: "ok",
    service: SERVICE_NAME,
    uptimeMs: now() - startedAtMs,
  }));
  server.get("/metrics", async (_request, reply) => {
    reply.type("text/plain; version=0.0.4; charset=utf-8");
    return obs.registry.toPrometheusText();
  });
  server.get("/manifest", async () => portfolioSummaryManifest);
  server.get("/assets", async () => portfolioSummaryManifest.assets);
  server.get("/budget", async () => portfolioSummaryBudget);
  server.post("/render", async (request, reply) => {
    const body = (request.body ?? {}) as Parameters<
      typeof renderPortfolioSummary
    >[0];
    const traceId = body.ctx?.traceId ?? `trace-${SERVICE_NAME}-${now()}`;
    const trace = createRequestTrace({ traceId });
    const requestSpan = trace.startSpan("request:/render", "request", {
      attributes: { service: SERVICE_NAME },
    });

    const startedRenderAtMs = now();
    const result = await renderPortfolioSummary(body, { trace });
    obs.renderDuration.observe((now() - startedRenderAtMs) / 1000, {
      route: "/render",
      status: String(result.statusCode),
    });

    trace.endSpan(requestSpan, {
      status: result.statusCode >= 400 ? "error" : "ok",
      attributes: { statusCode: result.statusCode },
    });

    // Fire-and-forget export so slow sinks never block the response.
    void exportTrace(trace).catch(() => {});

    reply.code(result.statusCode);
    return result.body;
  });

  return server;
}

function renderServiceHome({
  title,
  port,
  sampleHtml,
}: {
  title: string;
  port: number;
  sampleHtml: string;
}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui,sans-serif;margin:32px;line-height:1.5}main{max-width:760px}code{background:#f2f2f2;padding:2px 5px;border-radius:4px}section{margin:20px 0;padding:16px;border:1px solid #ddd}</style></head><body><main data-fragment-service="${title}"><h1>${title}</h1><p>This port serves an independently deployable SSR fragment service.</p><ul><li><a href="/health">/health</a></li><li><a href="/metrics">/metrics</a></li><li><a href="/manifest">/manifest</a></li><li><a href="/assets">/assets</a></li><li><a href="/budget">/budget</a></li><li><code>POST http://localhost:${port}/render</code></li></ul><h2>Sample render</h2>${sampleHtml}</main></body></html>`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const server = buildServer();
  await server.listen({ host: "0.0.0.0", port });
  console.log(`portfolio-summary listening on ${port}`);
}
