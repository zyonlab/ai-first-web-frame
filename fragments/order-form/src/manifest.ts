import { orderFormBudget } from "./budget";

/**
 * order-form fragment manifest (component-architecture doc §3).
 *
 * `renderStrategy: "dynamic-ssr"` — the form's account/margin preview is
 * request-time (per-user balance) plus realtime margin, so it must never be
 * cached across requests (`cachePolicy.ttl: 0`).
 *
 * `assets.js` lists the shared client chunks as **shared dependencies** rather
 * than re-bundling them: `@mvp/trade-client` (React + island runtime + store)
 * and `@mvp/ui/shadcn` (vendored Radix Slider/Tabs/Select). `@mvp/assets`
 * dedupes these so React/Radix ship exactly once for the whole page (spine
 * §4/§11). The fragment's own JS is only the island glue that hydrates the
 * `data-island="orderForm"` mount node.
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
    // Shared client chunks (deduped by @mvp/assets) + this fragment's island glue.
    js: ["@mvp/trade-client", "@mvp/ui/shadcn", "/assets/order-form.island.js"],
    css: ["/assets/order-form.css"],
  },
  budget: orderFormBudget,
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
