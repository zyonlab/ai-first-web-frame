import { marketsPageBudget } from "./budget";
import marketsPageSlots from "./manifest.slots.json";

export const marketsPageManifest = {
  name: "page-markets",
  route: "/markets",
  owner: "trading-core",
  version: "0.1.0",
  renderMode: "ssr",
  renderStrategy: "ssr",
  seo: {
    title: "MVP Perps — Markets",
    description:
      "Browse every perpetual market: last price, 24h change, funding, volume and open interest, each row deep-linking into its trade terminal.",
  },
  // Verified against src/manifest.slots.json + src/fragmentSlots.ts:
  //  - cached-ssr-freshness — the single "marketsTable" slot uses
  //    "cached-ssr" with cachePolicy.ttl = 5s (near-realtime table cache).
  //  - fallback-isolation — "marketsTable" is `required: true` and
  //    executeFragmentSlots runs with `onRequiredFailure: "fallback"`, so an
  //    unavailable fragment service degrades the page instead of failing it.
  demonstrates: ["cached-ssr-freshness", "fallback-isolation"],
  slots: marketsPageSlots,
  budget: marketsPageBudget,
} as const;

export function validateMarketsPageManifest(
  manifest = marketsPageManifest,
): boolean {
  return Boolean(
    manifest.route &&
      manifest.renderMode &&
      manifest.seo &&
      manifest.budget &&
      manifest.slots.length > 0,
  );
}
