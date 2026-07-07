import { portfolioPageBudget } from "./budget";
import portfolioPageSlots from "./manifest.slots.json";

export const portfolioPageManifest = {
  name: "page-portfolio",
  route: "/portfolio",
  owner: "trading-core",
  version: "0.1.0",
  renderMode: "ssr",
  renderStrategy: "dynamic-ssr",
  seo: {
    title: "MVP Perps — Portfolio",
    description:
      "Your account at a glance: equity, margin usage and realized/unrealized PnL, an open-positions holdings table, and a cumulative PnL chart — all server-rendered.",
  },
  slots: portfolioPageSlots,
  budget: portfolioPageBudget,
} as const;

export function validatePortfolioPageManifest(
  manifest = portfolioPageManifest,
): boolean {
  return Boolean(
    manifest.route &&
      manifest.renderMode &&
      manifest.seo &&
      manifest.budget &&
      manifest.slots.length > 0,
  );
}
