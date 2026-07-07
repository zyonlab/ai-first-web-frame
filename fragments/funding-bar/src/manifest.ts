import { fundingBarBudget } from "./budget";

/**
 * funding-bar fragment manifest (A2-funding slot).
 *
 * Pure SSR, no React island: near-realtime funding is short-TTL cached
 * (`cached-ssr`, 30s) and refreshed on navigation. Assets are a scoped CSS
 * sheet plus an optional tiny vanilla countdown tick (no framework). Data
 * dependency is the C5 `funding.<symbol>` source (with the oracle/mark price
 * read from the sibling `ticker.<symbol>` source through the shared C4 client).
 */
export const fundingBarManifest = {
  name: "funding-bar",
  owner: "market-data",
  version: "0.1.0",
  renderMode: "ssr",
  renderStrategy: "cached-ssr",
  cachePolicy: {
    // Near-realtime funding: short TTL so the countdown/rate stay fresh.
    ttl: 30,
    tags: ["funding"],
    vary: ["props"],
  },
  endpoint: "/render",
  fallback:
    '<section data-fragment="funding-bar" data-fallback="true">Funding unavailable</section>',
  assets: {
    // Zero framework JS. The countdown label is server-rendered (recomputed each
    // SSR request within the short TTL) with a CSS-only pulse for liveness; the
    // live per-second tick is a P3 enhancement served as a built client asset.
    js: [],
    css: ["/assets/funding-bar.css"],
  },
  budget: fundingBarBudget,
  dataDependencies: ["funding"],
  metadata: {
    category: "trading",
    description:
      "SSR funding-rate bar: current funding, next-funding countdown, oracle price (no island)",
  },
} as const;

export function validateFundingBarManifest(
  manifest = fundingBarManifest,
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
