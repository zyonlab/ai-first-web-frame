import { orderBookBudget } from "./budget";

/**
 * order-book fragment manifest — literal shape from
 * docs/trade-demo/02-component-architecture.md §3.1.
 *
 * - `renderMode: ssr`, `renderStrategy: dynamic-ssr` (realtime ladder).
 * - `cachePolicy.ttl: 0` — realtime, never cached at the fragment layer.
 * - `assets.js` declares only the fragment-local patch client (D3 shared
 *   dependency, deduped by `@mvp/assets`, NOT re-bundled) plus the fragment's
 *   own vanilla patch client. No React ships from this fragment.
 * - `dataDependencies` references the C5 book source id template `book.l2.<symbol>`.
 */
export const orderBookManifest = {
  name: "order-book",
  owner: "trading-core",
  version: "0.1.0",
  renderMode: "ssr",
  renderStrategy: "dynamic-ssr",
  cachePolicy: { ttl: 0, tags: ["book"], vary: ["locale", "props"] },
  endpoint: "/render",
  fallback:
    '<section data-fragment="order-book" data-fallback="true">Order book unavailable</section>',
  assets: {
    js: ["/assets/order-book.client.js"],
    css: ["/assets/order-book.css"],
  },
  // dependsOn / dataDependencies use the C5 symbol-scoped book id template.
  dependsOn: [],
  dataDependencies: ["book.l2.<symbol>"],
  // Source-id TEMPLATES this fragment's browser panel subscribes to. Distinct
  // from `dataDependencies`, which is what SSR reads: a fragment can read a
  // source once at render time without keeping it live. `<symbol>` is bound by
  // the page at mount time; changing it re-subscribes the panel.
  subscriptions: ["book.l2.<symbol>"],
  // A row click feeds the order-form price (published on the shared store by the
  // page's order-book→order-form bridge); modeled here as the slice's producer.
  produces: { slices: ["trade.order-draft.price"] },
  layoutHint: { shape: "ladder", fills: true, minHeight: 300 },
  budget: orderBookBudget,
  metadata: {
    category: "trading",
    description: "Realtime L2 order book ladder with depth bars",
  },
} as const;

export function validateOrderBookManifest(
  manifest = orderBookManifest,
): boolean {
  return Boolean(
    manifest.name &&
      manifest.owner &&
      manifest.version &&
      manifest.renderMode &&
      manifest.renderStrategy &&
      manifest.fallback &&
      manifest.assets &&
      manifest.budget,
  );
}
