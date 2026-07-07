import { openOrdersBudget } from "./budget";

export const openOrdersManifest = {
  name: "open-orders",
  owner: "trading-core",
  version: "0.1.0",
  renderMode: "ssr",
  // Realtime working-orders table: rendered per request, patched live
  // client-side (row upsert/remove + cancel). No TTL.
  renderStrategy: "dynamic-ssr",
  cachePolicy: {
    // User-private realtime ⇒ no caching; tags let a symbol switch / order
    // mutation invalidate the slot.
    ttl: 0,
    tags: ["orders"],
    vary: ["locale", "props"],
  },
  endpoint: "/render",
  fallback:
    '<section data-fragment="open-orders" data-fallback="true">Open orders temporarily unavailable</section>',
  assets: {
    // Patch-only: React is NOT bundled here. The island mounts through the
    // shared @mvp/trade-client chunk (deduped by @mvp/assets so it ships once),
    // plus this fragment's own tiny vanilla patch asset (upsert/remove/cancel).
    js: ["@mvp/trade-client", "/assets/open-orders.patch.js"],
    css: ["/assets/open-orders.css"],
  },
  budget: openOrdersBudget,
  // User-private realtime data dependency: orders (contract C5, global id).
  dataDependencies: ["orders"],
  metadata: {
    category: "trading",
    description:
      "Realtime working-orders table with cancel controls; patch-only, no React",
  },
} as const;

export function validateOpenOrdersManifest(
  manifest = openOrdersManifest,
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
