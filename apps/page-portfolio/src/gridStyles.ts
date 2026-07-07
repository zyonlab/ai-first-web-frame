/**
 * Portfolio page CSS (contract source: docs/trade-demo/01-ui-layout.md §4.4 —
 * "/portfolio page shell"). The page is a simple stacked column: a summary
 * region (equity / margin usage / PnL) on top, the holdings body in the middle,
 * and the PnL chart docked below. The page shell owns the layout; each region's
 * body is filled by one fragment's SSR HTML (portfolio-summary, pnl-chart) or a
 * no-JS-readable fallback.
 *
 * All colors come from the frozen `@mvp/design-system` semantic color tokens
 * (`--mvp-color-*`) and all spacing/radius from the token scale — no hard-coded
 * hex colors and no raw pixels for spacing (spine §13 / CLAUDE.md hard rule).
 *
 * Emitted as a plain string so the RSC page injects it once via a `<style>` tag
 * and tests can assert the layout regions exist without a browser.
 */
export const PORTFOLIO_LAYOUT_CLASS = "portfolio-page" as const;

export const portfolioLayoutCss = `
.${PORTFOLIO_LAYOUT_CLASS} {
  display: flex;
  flex-direction: column;
  gap: var(--mvp-spacing-md);
  min-height: 100dvh;
  max-width: 1120px;
  margin: 0 auto;
  padding: var(--mvp-spacing-lg);
  box-sizing: border-box;
  background: var(--mvp-color-surface-0);
  color: var(--mvp-color-ink);
}
.${PORTFOLIO_LAYOUT_CLASS} [data-area="portfolio-head"] {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--mvp-spacing-md);
  flex-wrap: wrap;
}
.${PORTFOLIO_LAYOUT_CLASS} [data-area="portfolio-head"] h1 {
  margin: 0;
  font-size: 1.5rem;
}
.${PORTFOLIO_LAYOUT_CLASS} [data-area="portfolio-summary"] {
  border: 1px solid var(--mvp-color-border);
  border-radius: var(--mvp-radius-md);
  background: var(--mvp-color-surface-1);
  padding: var(--mvp-spacing-md);
  min-width: 0;
}
.${PORTFOLIO_LAYOUT_CLASS} [data-area="portfolio-chart"] {
  border: 1px solid var(--mvp-color-border);
  border-radius: var(--mvp-radius-md);
  background: var(--mvp-color-surface-1);
  padding: var(--mvp-spacing-md);
  /* The chart canvas/image x-scrolls inside its own container so the page body
     never scrolls horizontally on narrow viewports (01 doc responsive rule). */
  overflow-x: auto;
  min-width: 0;
}
.${PORTFOLIO_LAYOUT_CLASS} [data-area="portfolio-holdings"] {
  border: 1px solid var(--mvp-color-border);
  border-radius: var(--mvp-radius-md);
  background: var(--mvp-color-surface-1);
  /* Holdings table x-scrolls inside its own container (never the page body). */
  overflow-x: auto;
  min-width: 0;
}
.${PORTFOLIO_LAYOUT_CLASS} [data-area="portfolio-holdings"] a {
  color: var(--mvp-color-accent);
}

/* Mobile < md (768px): collapse padding and let regions reflow. */
@media (max-width: 767px) {
  .${PORTFOLIO_LAYOUT_CLASS} {
    padding: var(--mvp-spacing-md);
    gap: var(--mvp-spacing-sm);
  }
}
`.trim();
