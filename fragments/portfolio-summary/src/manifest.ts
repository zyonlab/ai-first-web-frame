import { portfolioSummaryBudget } from "./budget";

/**
 * portfolio-summary fragment manifest (A2-portfolio slot).
 *
 * Pure SSR, no React island: the portfolio overview (equity / unrealized PnL /
 * margin usage / withdrawable) plus the open-positions table is fully
 * request-time (`dynamic-ssr`, ttl 0 — user-private, never cached). Assets are a
 * single scoped CSS sheet and NO JS. Data dependencies are the three frozen C5
 * user-private sources read through ONE shared C4 client:
 * `account` (request-time), `positions` (realtime, poll fallback), and
 * `balances` (request-time).
 */
export const portfolioSummaryManifest = {
  name: "portfolio-summary",
  owner: "trading-core",
  version: "0.1.0",
  renderMode: "ssr",
  renderStrategy: "dynamic-ssr",
  cachePolicy: {
    // Request-time, user-private: no caching (ttl 0). Tags let an account /
    // positions update invalidate this slot when the runtime supports it.
    ttl: 0,
    tags: ["account", "positions", "balances"],
    vary: ["tenant", "props"],
  },
  endpoint: "/render",
  fallback:
    '<section data-fragment="portfolio-summary" data-fallback="true">Portfolio unavailable</section>',
  assets: {
    // Zero framework JS: the overview cards + positions table are server-safe
    // static HTML (no island). No-JS readable by design.
    js: [],
    css: ["/assets/portfolio-summary.css"],
  },
  budget: portfolioSummaryBudget,
  dataDependencies: ["account", "positions", "balances"],
  metadata: {
    category: "trading",
    description:
      "SSR portfolio overview: equity / unrealized PnL / margin usage / withdrawable cards + open-positions table (no island)",
  },
} as const;

export function validatePortfolioSummaryManifest(
  manifest = portfolioSummaryManifest,
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
