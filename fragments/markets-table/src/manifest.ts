import { marketsTableBudget } from "./budget";

/**
 * markets-table fragment manifest (A2-markets slot).
 *
 * Pure SSR, no React island: the markets list is near-realtime and served as a
 * short-TTL cached snapshot (`cached-ssr`, 5s) refreshed on navigation. Each row
 * is a plain `<a href="/trade/<SYMBOL>">` deep link so the list is fully usable
 * with no JS. Assets are a scoped CSS sheet only. Data dependency is the C5
 * `markets.index` source (near-realtime, public), enriched per-symbol from the
 * sibling `ticker`/`funding` sources through the shared C4 client.
 */
export const marketsTableManifest = {
  name: "markets-table",
  owner: "market-data",
  version: "0.1.0",
  renderMode: "ssr",
  renderStrategy: "cached-ssr",
  cachePolicy: {
    // Near-realtime markets index: short TTL so last price / 24h% stay fresh.
    ttl: 5,
    tags: ["markets"],
    vary: ["locale", "props"],
  },
  endpoint: "/render",
  fallback:
    '<section data-fragment="markets-table" data-fallback="true">Markets unavailable</section>',
  assets: {
    // Zero framework JS: rows are server-rendered anchors. The optional live
    // per-cell price tick is a P3 enhancement served as a tiny built asset.
    js: [],
    css: ["/assets/markets-table.css"],
  },
  budget: marketsTableBudget,
  dataDependencies: ["markets.index"],
  metadata: {
    category: "trading",
    description:
      "SSR near-realtime markets list table; each row deep-links to /trade/<symbol> (no island)",
  },
} as const;

export function validateMarketsTableManifest(
  manifest = marketsTableManifest,
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
