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
