import { positionsTableBudget } from "./budget";

/**
 * positions-table fragment manifest — mirrors the order-book / trades-feed
 * literal shape (docs/trade-demo/02-component-architecture.md §3).
 *
 * - `renderMode: ssr`, `renderStrategy: dynamic-ssr` (realtime, no TTL — the
 *   positions feed is user-private realtime data).
 * - `cachePolicy.ttl: 0` — realtime, never cached at the fragment layer; tags
 *   let a symbol switch / position update invalidate the slot.
 * - `assets.js` declares the shared `@mvp/trade-client` chunk (shared
 *   dependency, deduped by `@mvp/assets`, NOT re-bundled) plus the fragment's
 *   own vanilla patch client. No React ships from this fragment.
 * - `dataDependencies` references the C5 global `positions` source id.
 */
export const positionsTableManifest = {
  name: "positions-table",
  owner: "trading-core",
  version: "0.1.0",
  renderMode: "ssr",
  // Realtime table: rendered per request, patched live client-side. No TTL.
  renderStrategy: "dynamic-ssr",
  cachePolicy: {
    // Realtime ⇒ no caching; tags let a position update invalidate the slot.
    ttl: 0,
    tags: ["positions"],
    vary: ["locale", "props"],
  },
  endpoint: "/render",
  fallback:
    '<section data-fragment="positions-table" data-fallback="true">Positions unavailable</section>',
  assets: {
    // Patch-only: React is NOT bundled here. The island mounts through the
    // shared @mvp/trade-client chunk (deduped by @mvp/assets so it ships once),
    // plus this fragment's own tiny vanilla patch asset.
    js: ["@mvp/trade-client", "/assets/positions-table.patch.js"],
    css: ["/assets/positions-table.css"],
  },
  budget: positionsTableBudget,
  // Realtime data dependency: the C5 global `positions` source (user-private).
  dataDependencies: ["positions"],
  metadata: {
    category: "trading",
    description:
      "Realtime open-positions table (size/entry/mark/liq/uPnL + close); patch-only, no React",
  },
} as const;

export function validatePositionsTableManifest(
  manifest = positionsTableManifest,
): boolean {
  return Boolean(
    manifest.name &&
      manifest.owner &&
      manifest.version &&
      manifest.renderMode &&
      manifest.renderStrategy &&
      manifest.fallback &&
      manifest.assets &&
      manifest.budget &&
      Array.isArray(manifest.dataDependencies) &&
      manifest.dataDependencies.length > 0,
  );
}
