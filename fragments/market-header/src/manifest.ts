import { sourceIds } from "@mvp/trade-data";
import { marketHeaderBudget } from "./budget";

/**
 * market-header fragment manifest (A2-header). Mirrors the
 * `promotion-banner/src/manifest.ts` shape and is validated by
 * {@link validateMarketHeaderManifest}.
 *
 * - `renderStrategy: "cached-ssr"` with a short 5s TTL: the header is
 *   near-realtime, so SSR serves a last-known-good snapshot behind a tiny TTL
 *   while the island patches mark/change/countdown live.
 * - `assets.js` lists only the fragment-local island glue (D3 /
 *   spine §11) so React/Radix bundle once; only the small island glue is
 *   fragment-owned. `@mvp/assets` dedupes the shared chunk across fragments.
 * - `dataDependencies` are the C5 source ids for the default symbol; the slot
 *   re-resolves them per active symbol.
 */
export const DEFAULT_SYMBOL = "BTC";

export const marketHeaderManifest = {
  name: "market-header",
  owner: "market-data",
  version: "0.1.0",
  renderMode: "ssr",
  renderStrategy: "cached-ssr",
  cachePolicy: {
    // Near-realtime: short TTL so the SSR snapshot never goes stale while the
    // island streams live patches on top.
    ttl: 5,
    tags: ["ticker", "funding", "market-header"],
    vary: ["tenant", "locale", "props"],
  },
  endpoint: "/render",
  fallback:
    '<section data-fragment="market-header" data-fallback="true">Market header unavailable</section>',
  assets: {
    // The small island glue this fragment owns. (React ships inside the
    // consuming page's bundle via TradeHydrator's static import; the dead
    // "@mvp/trade-client" placeholder that used to claim otherwise is gone.)
    js: ["/assets/market-header.island.js"],
    css: ["/assets/market-header.css"],
  },
  budget: marketHeaderBudget,
  consumes: { slices: ["trade.active-symbol"] },
  layoutHint: { shape: "bar", fills: true, minHeight: 56 },
  dataDependencies: [
    sourceIds.ticker(DEFAULT_SYMBOL),
    sourceIds.funding(DEFAULT_SYMBOL),
  ],
  metadata: {
    category: "trading",
    description:
      "Near-realtime market header: pair, mark/oracle, 24h change, funding, volume, next-funding countdown",
  },
} as const;

export function validateMarketHeaderManifest(
  manifest = marketHeaderManifest,
): boolean {
  return Boolean(
    manifest.name &&
      manifest.owner &&
      manifest.version &&
      manifest.renderMode &&
      manifest.fallback &&
      manifest.assets &&
      manifest.budget &&
      Array.isArray(manifest.dataDependencies) &&
      manifest.dataDependencies.length > 0,
  );
}
