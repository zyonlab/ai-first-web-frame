import { orderFormBudget } from "./budget";

/**
 * order-form fragment manifest (component-architecture doc §3).
 *
 * `renderStrategy: "dynamic-ssr"` — the form's account/margin preview is
 * request-time (per-user balance) plus realtime margin, so it must never be
 * cached across requests (`cachePolicy.ttl: 0`).
 *
 * `assets.js` (C3 spike, docs/ARCHITECTURE_REFACTOR_PLAN.md §4.3.3 "Runtime
 * island assets"): `/assets/order-form.island.js` is now a REAL, served
 * browser ESM bundle (`island.browser.ts`, tsdown-built, `react`/
 * `react/jsx-runtime`/`react-dom/client`/`@mvp/trade-contracts`/
 * `@mvp/ui/shadcn` externalized) — fetchable at this fragment's own
 * `/assets/order-form.island.js` route, not just declared metadata.
 * `apps/page-trade` builds and self-hosts the matching shared vendor chunk
 * for those externals and resolves them via a `<script type="importmap">`.
 * The registry entry's `assetsUrl` (see `registry/registry.data.json`) is
 * the absolute URL a page actually dynamically `import()`s at runtime; this
 * relative path is the fragment-local convention that URL resolves to.
 * Previously this array listed `@mvp/trade-client` (a package that no
 * longer exists — dead metadata from before that package was split apart)
 * and `@mvp/ui/shadcn` as bare package-name placeholders nothing ever
 * resolved; both are now gone (see the registry entry / `apps/page-trade`
 * import map for the real resolution instead).
 *
 * `dataDependencies` declares the `account` node (request-time margin), shared
 * with account-bar / positions-table so the runtime resolves it once per SSR
 * request (duplicate-data-resolution dedupe hint).
 */
export const orderFormManifest = {
  name: "order-form",
  owner: "trading-core",
  version: "0.1.0",
  renderMode: "ssr",
  renderStrategy: "dynamic-ssr",
  cachePolicy: {
    ttl: 0,
    tags: ["order-form"],
    vary: ["tenant", "locale", "props"],
  },
  endpoint: "/render",
  fallback:
    '<section data-fragment="order-form" data-fallback="true">Order form unavailable</section>',
  assets: {
    // Real, served browser ESM bundle (C3 spike). No more placeholder
    // package-name entries — see the doc comment above.
    js: ["/assets/order-form.island.js"],
    css: ["/assets/order-form.css"],
  },
  budget: orderFormBudget,
  /**
   * Browser-reachable data endpoint for this fragment's island.
   *
   * The SSR render seeds the margin preview once; after hydration the island
   * needs to re-read it, and it cannot call this service directly — in compose
   * and k8s `order-form` is an internal DNS name the browser cannot resolve, and
   * exposing it would leak internal topology (the same class of problem as
   * naming a fallback by `serviceUrl`).
   *
   * The relative form resolves against this fragment's own registry
   * `serviceUrl`, so it is correct in every environment without interpolating an
   * env var into a static manifest. The shell gateway mounts it at
   * `/_fragment/order-form/account`.
   */
  proxy: { account: "/account" },
  consumes: {
    slices: [
      "trade.active-symbol",
      "trade.hovered-price",
      "trade.order-draft.price",
    ],
  },
  produces: { slices: ["trade.leverage", "trade.order-draft"] },
  layoutHint: { shape: "panel", fills: true },
  dataDependencies: ["account"],
  metadata: {
    category: "trading",
    description:
      "Request-time order-entry form (market/limit, size, leverage, buy/sell, reduce-only) with account/margin preview and an order-form island",
  },
} as const;

export function validateOrderFormManifest(
  manifest = orderFormManifest,
): boolean {
  return Boolean(
    manifest.name &&
      manifest.owner &&
      manifest.version &&
      manifest.renderMode &&
      manifest.fallback &&
      manifest.assets &&
      manifest.budget,
  );
}
