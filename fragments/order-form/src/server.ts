import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseFragmentRenderRequest } from "@mvp/contracts";
import { createRequestTrace, exportTrace } from "@mvp/observability";
import Fastify from "fastify";
import { orderFormBudget } from "./budget";
import { orderFormManifest } from "./manifest";
import {
  configureFragmentTraceExport,
  createFragmentObservability,
  type FragmentObservability,
  SERVICE_NAME,
} from "./observability";
import { renderOrderForm } from "./render";

export type BuildServerOptions = {
  /** Injectable clock for deterministic uptime in tests. */
  now?: () => number;
  /** Injectable observability, mainly to assert metrics in tests. */
  observability?: FragmentObservability;
};

const DEFAULT_PORT = 4205;

/** Routes excluded from HTTP metrics to keep scrape/health noise out of p95. */
const UNINSTRUMENTED_ROUTES = new Set(["/metrics", "/health"]);

/**
 * Real, browser-loadable island module (C3 spike, §4.3.3 "Runtime island
 * assets") — the tsdown browser build of `island.browser.ts`
 * (`pnpm run build:island-browser`; a MANUAL script since the C3 no-go
 * decision unchained it from this package's `build` — the route below
 * answers a structured 404 until it is run). Resolved relative to THIS
 * file so it works whether the server
 * runs from `src/server.ts` (tsx, dev) or the built `dist/server.js` (node,
 * prod) — both sit next to `dist-browser/` under the fragment root.
 *
 * Before this route, `/assets` only ever returned the manifest's `assets`
 * JSON *metadata* — no fragment served an actual browser-loadable file at
 * any of those declared paths. This route is the fix: a real file, at a
 * real URL, actually fetchable over HTTP.
 */
const ISLAND_BROWSER_BUNDLE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist-browser",
  "island.browser.js",
);

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
    const demo = await renderOrderForm({
      ctx: { locale: "en-US" },
      props: { symbol: "BTC" },
    });
    reply.type("text/html; charset=utf-8");
    return renderServiceHome({
      title: "order-form fragment",
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
  server.get("/manifest", async () => orderFormManifest);
  server.get("/assets", async () => orderFormManifest.assets);
  server.get("/assets/order-form.island.js", async (_request, reply) => {
    try {
      const bundle = await readFile(ISLAND_BROWSER_BUNDLE_PATH, "utf8");
      reply.type("text/javascript; charset=utf-8");
      // Unversioned path — fine for the spike's single canary deployment,
      // but NOT immutable/cacheable the way a real rollout needs (§4.3.3
      // findings: a real asset URL needs a content hash or version segment
      // so it's safe to cache aggressively).
      reply.header("Cache-Control", "no-store");
      // Real spike finding: a page (apps/page-trade, a different origin —
      // localhost:4103 vs this fragment's localhost:4205) dynamically
      // `import()`ing this module is a CROSS-ORIGIN module fetch, which the
      // ES module spec always fetches in CORS mode. Without this header a
      // real browser blocks the import outright (opaque response) — this
      // was only caught by actually loading the page in a browser and
      // reading the console, not by curl or a unit test. `*` is fine for a
      // publicly-cacheable, non-credentialed static asset; a real rollout
      // should scope this to known consuming page origins.
      reply.header("Access-Control-Allow-Origin", "*");
      return bundle;
    } catch {
      reply.code(404);
      return {
        error: {
          code: "island-bundle-not-built",
          message:
            "dist-browser/island.browser.js is missing — run `pnpm --filter @mvp/fragment-order-form run build:island-browser` (or `build`) first.",
        },
      };
    }
  });
  server.get("/budget", async () => orderFormBudget);
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
    // Adapt the validated envelope to this fragment's internal request type.
    const body = parsed.request as Parameters<typeof renderOrderForm>[0];
    const traceId = body.ctx?.traceId ?? `trace-${SERVICE_NAME}-${now()}`;
    const trace = createRequestTrace({ traceId });
    const requestSpan = trace.startSpan("request:/render", "request", {
      attributes: { service: SERVICE_NAME },
    });

    const startedRenderAtMs = now();
    const result = await renderOrderForm(body, { trace });
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
  console.log(`order-form listening on ${port}`);
}
