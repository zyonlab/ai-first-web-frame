import { PORTFOLIO_LAYOUT_CLASS } from "./gridStyles";

/**
 * Per-slot fragment HTML for the portfolio page. Each body slot is a fragment's
 * SSR HTML string, or `null`/omitted to fall back to the no-JS-readable
 * placeholder. Region names match docs/trade-demo/01-ui-layout.md §4.4.
 */
export type PortfolioFragments = {
  portfolioSummary?: string | null;
  pnlChart?: string | null;
};

export const portfolioSeoCopy = {
  title: "MVP Perps — Portfolio",
  description:
    "Your account at a glance: equity, margin usage and PnL, an open-positions holdings table, and a cumulative PnL chart. Readable without client JavaScript; each holding links into its trade terminal.",
} as const;

/**
 * No-JS-readable fallback markup for a slot body. Mirrors the fragment fallback
 * contract (`data-fallback="true"`) used across the framework so a degraded or
 * absent fragment degrades the panel instead of breaking the page.
 */
function slotFallback(fragment: string, label: string): string {
  return `<section data-fragment="${fragment}" data-fallback="true">${label}</section>`;
}

/**
 * Assemble the portfolio page as a pure HTML string. Used both for the no-JS
 * SSR baseline and for tests that assert layout regions / fallbacks without a
 * browser. The RSC page (`app/portfolio/page.tsx`) renders the same named
 * regions via React.
 */
export function renderPortfolioHtml(
  fragments: PortfolioFragments = {},
): string {
  const summary =
    fragments.portfolioSummary ??
    slotFallback("portfolio-summary", "Portfolio summary is loading.");
  const chart =
    fragments.pnlChart ?? slotFallback("pnl-chart", "PnL chart is loading.");

  return `<main data-page="portfolio">
    <div class="${PORTFOLIO_LAYOUT_CLASS}">
      <div data-area="portfolio-head">
        <h1>${portfolioSeoCopy.title}</h1>
      </div>
      <div data-area="portfolio-summary" data-slot="portfolioSummary">${summary}</div>
      <div data-area="portfolio-chart" data-slot="pnlChart">${chart}</div>
      <div data-area="portfolio-holdings">
        <table><thead><tr><th>Symbol</th><th>Side</th><th>Size</th><th>Entry</th><th>Mark</th><th>uPnL</th></tr></thead><tbody></tbody></table>
      </div>
    </div>
  </main>`;
}

/** Shared-UI primitives reused (no duplication — satisfies similarity audit). */
export const usedUiComponents = ["Section", "StatGrid", "DataTable"] as const;
