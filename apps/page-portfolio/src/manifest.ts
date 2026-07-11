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
  // Verified against src/manifest.slots.json + src/fragmentSlots.ts:
  //  - private-data-dynamic-ssr — "portfolioSummary" is `dynamic-ssr` with
  //    cachePolicy.ttl = 0 (equity/margin/PnL are user-private and must
  //    render fresh per request, per the comment on
  //    fetchPortfolioFragmentSlots). Required: true, so its own failure
  //    reports the page degraded rather than silently empty.
  //  - ttl-cache-freshness — "pnlChart" uses the "ttl-cache" strategy with
  //    cachePolicy.ttl = 60s.
  //  - fallback-isolation — executeFragmentSlots runs with
  //    `onRequiredFailure: "fallback"`.
  //  - streaming:suspense-per-slot — streamPortfolioFragmentSlots +
  //    per-slot <Suspense><FragmentSlotStream/> boundaries in
  //    app/portfolio/page.tsx.
  demonstrates: [
    "private-data-dynamic-ssr",
    "ttl-cache-freshness",
    "fallback-isolation",
    "streaming:suspense-per-slot",
  ],
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
