import { tradePageBudget } from "./budget";
import tradePageSlots from "./manifest.slots.json";

export const tradePageManifest = {
  name: "page-trade",
  route: "/trade/:symbol",
  owner: "trading-core",
  version: "0.1.0",
  renderMode: "hybrid",
  renderStrategy: "hybrid",
  seo: {
    title: "MVP Perps — Trade Terminal",
    description:
      "Server-rendered perpetuals trade terminal composing the order book, order form, market header, and account panels into one dense grid.",
  },
  slots: tradePageSlots,
  budget: tradePageBudget,
} as const;

export function validateTradePageManifest(
  manifest = tradePageManifest,
): boolean {
  return Boolean(
    manifest.route &&
      manifest.renderMode &&
      manifest.seo &&
      manifest.budget &&
      manifest.slots.length > 0,
  );
}
