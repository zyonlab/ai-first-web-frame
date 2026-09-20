# @mvp/fragment-host — AGENT.md

## What this package is for

The single HTTP host every SSR fragment service runs on. A fragment's
`src/server.ts` is a ~20-line adapter that names the fragment and hands the host
its manifest, budget, render function and demo request; the host owns every
route, the metrics registry and the trace export pipeline.

It exists because that HTTP layer used to be copy-pasted: 14 `src/server.ts`
files of 130–188 lines each (two randomly picked copies differed by 28 lines,
all of it name/port/render-function noise) plus 14 near-identical
`src/observability.ts` files. Changing the fragment HTTP contract meant 14
edits, the copies had already drifted, and the drift was invisible to
`pnpm audit:similarity`, which only fingerprinted `.tsx`.

## The route contract

| Route | Behavior |
| --- | --- |
| `GET /` | Browser-readable demo page: endpoint index plus one live render of `options.demo`. Stamps `data-fragment-version`. |
| `GET /health` | `{ status, service, version, uptimeMs }`. Dependency free — never fans out into data or other fragments. |
| `GET /ready` | Identical payload; a separate target so a rollout system can point readiness and liveness at different routes. |
| `GET /metrics` | Prometheus text exposition (`PROMETHEUS_CONTENT_TYPE`). |
| `GET /manifest` | The fragment manifest, verbatim. |
| `GET /assets` | `manifest.assets`, verbatim. |
| `GET /budget` | The fragment budget, verbatim. |
| `POST /render` | `parseFragmentRenderRequest` (strict → lenient → structured `ZodIssue[]`), then `render(body, { trace, now })`. A malformed envelope is a `400` with `{ error: { code: "invalid-render-request", issues } }`. |

`/health` and `/ready` carry the manifest **version**. That is what makes a
fragment independently deployable in practice: a deployment system can confirm
which build answered before promoting that version's registry channel with
`scripts/promote-fragment.mts`.

`/metrics`, `/health` and `/ready` are excluded from HTTP metrics so probe and
scrape traffic never skews p95.

## Entry points

- `createFragmentServer<TRequest>(options): FastifyInstance` — options are
  `{ serviceName, port, manifest, budget, render, demo, extraRoutes?, now?, observability? }`.
  `now` and `observability` are injectable for deterministic tests; `now` is also
  forwarded into `render` so a time-dependent render stays deterministic.
- `startFragmentServer(server, { serviceName, port })` — binds `PORT` (falling
  back to the fragment's default) and logs one line.
- `isProcessEntry(import.meta.url)` — true when the importing module is the
  process entry point; the guard every fragment's CLI block uses.
- `createFragmentObservability()` — registry + HTTP recorder + the
  `fragment_render_duration_seconds` histogram (buckets tuned to the 200ms
  fragment latency budget).
- `configureFragmentTraceExport(serviceName)` — installs the file + console
  exporters once per process per service; `TRACE_SAMPLE_RATE` overrides the rate.
- `resetFragmentTraceExportState()` — test hook.
- `renderFragmentServiceHome({ title, version, port, sampleHtml })` — the demo page.

## Render contract

```ts no-run
// Every fragment's src/render.ts exports this shape.
export async function renderMyFragment(
  request: MyFragmentRenderRequest,
  options: { trace?: RequestTrace; now?: () => number } = {},
): Promise<{ statusCode: number; body: FragmentRenderResponse }> {
  // 200 + a FragmentRenderResponse on the happy path;
  // 4xx/5xx + a metadata.fallback-stamped response when degraded.
}
```

Degraded output must set `metadata.fallback: true` — that is what
`@mvp/runtime`'s `isFallbackResponse` reads (the legacy HTML-marker sniff is
deprecated).

## Example

```ts
import { createFragmentServer } from "@mvp/fragment-host";

const manifest = {
  name: "price-panel",
  version: "0.1.0",
  assets: { js: [], css: [] },
};

async function renderPricePanel(request: { props?: { symbol?: string } }) {
  if (!request.props?.symbol) {
    return {
      statusCode: 400,
      body: {
        html: '<section data-fragment="price-panel" data-fallback="true"></section>',
        assets: { js: [], css: [] },
        cache: { ttl: 5, tags: ["price-panel"] },
        metadata: { name: "price-panel", version: "0.1.0", fallback: true },
      },
    };
  }
  return {
    statusCode: 200,
    body: {
      html: `<section data-fragment="price-panel">${request.props.symbol}</section>`,
      assets: { js: [], css: [] },
      cache: { ttl: 60, tags: ["price-panel"] },
      metadata: { name: "price-panel", version: "0.1.0" },
    },
  };
}

let clock = 1_000;
const server = createFragmentServer({
  serviceName: "price-panel",
  port: 4203,
  manifest,
  budget: { scope: "fragment", name: "price-panel" },
  render: renderPricePanel,
  demo: { props: { symbol: "BTC" } },
  now: () => clock,
});

// /health reports WHICH version is live — the deploy-verification hook.
clock = 1_750;
const health = await server.inject({ method: "GET", url: "/health" });
const healthBody = health.json();
if (healthBody.version !== "0.1.0") throw new Error("version not reported");
if (healthBody.uptimeMs !== 750) throw new Error("injected clock ignored");

// /ready answers the same shape for a separate probe target.
const ready = await server.inject({ method: "GET", url: "/ready" });
if (ready.json().service !== "price-panel") throw new Error("/ready missing");

// POST /render validates the envelope, then renders.
const rendered = await server.inject({
  method: "POST",
  url: "/render",
  payload: { ctx: { locale: "en-US" }, props: { symbol: "BTC" } },
});
if (!rendered.json().html.includes("BTC")) throw new Error("render body wrong");

// A malformed envelope is a structured 400, never a crash.
const bad = await server.inject({
  method: "POST",
  url: "/render",
  payload: { ctx: "not-an-object" },
});
if (bad.statusCode !== 400) throw new Error("bad envelope must 400");
if (bad.json().error.code !== "invalid-render-request") {
  throw new Error("error envelope drifted");
}

// Probe and scrape routes stay out of the HTTP metrics.
const metrics = await server.inject({ method: "GET", url: "/metrics" });
if (!metrics.body.includes('route="/render"')) throw new Error("no render metric");
if (metrics.body.includes('route="/health"')) throw new Error("probe leaked into metrics");
```

## Adding a fragment

Use the scaffolder — it generates a fragment already wired to this host, with an
allocated port and a Dockerfile that builds:

```
pnpm --filter @mvp/create-component start -- PricePanel --type fragment
```

See [tools/create-component/AGENT.md](../../tools/create-component/AGENT.md) and
`docs/OPERATIONS.md`.

## Accept

```
pnpm --filter @mvp/fragment-host test
```
Expected: Vitest exits 0. `src/index.test.ts` covers the whole route contract,
the injected clock and observability, extra routes, and trace export.
