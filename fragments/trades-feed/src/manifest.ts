import { tradesFeedBudget } from "./budget";

export const tradesFeedManifest = {
  name: "trades-feed",
  owner: "trading-core",
  version: "0.1.0",
  renderMode: "ssr",
  // Realtime tape: rendered per request, patched live client-side. No TTL.
  renderStrategy: "dynamic-ssr",
  cachePolicy: {
    // Realtime ⇒ no caching; tags let a symbol switch invalidate the slot.
    ttl: 0,
    tags: ["trades"],
    vary: ["locale", "props"],
  },
  endpoint: "/render",
  fallback:
    '<section data-fragment="trades-feed" data-fallback="true">Trades feed temporarily unavailable</section>',
  assets: {
    // Patch-only: React is NOT bundled here. The island mounts through the
    // shared @mvp/trade-client chunk (deduped by @mvp/assets so it ships once),
    // plus this fragment's own tiny vanilla patch asset.
    js: ["@mvp/trade-client", "/assets/trades-feed.patch.js"],
    css: ["/assets/trades-feed.css"],
  },
  budget: tradesFeedBudget,
  layoutHint: { shape: "table", fills: true },
  // Realtime data dependency: trades.<symbol> (contract C5).
  dataDependencies: ["trades.<symbol>"],
  metadata: {
    category: "trading",
    description:
      "Realtime trades tape (recent prints, newest first); patch-only, no React",
  },
} as const;

export function validateTradesFeedManifest(
  manifest = tradesFeedManifest,
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
