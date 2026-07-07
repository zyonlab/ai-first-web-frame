/**
 * Markets page CSS (contract source: docs/trade-demo/01-ui-layout.md §5 —
 * "Markets page layout"). Unlike the trade terminal this is a simple
 * single-column page: a header/filter bar stacked above the `markets-table`
 * fragment body. The page shell owns the layout; the table body is filled by
 * one fragment's SSR HTML.
 *
 * All colors come from the frozen `@mvp/design-system` semantic color tokens
 * (`--mvp-color-*`) and all spacing/radius from the token scale — no hard-coded
 * hex colors and no raw pixels for spacing (spine §13 / CLAUDE.md hard rule).
 *
 * Emitted as a plain string so the RSC page injects it once via a `<style>` tag
 * and tests can assert the layout regions exist without a browser.
 */
export const MARKETS_LAYOUT_CLASS = "markets-page" as const;

export const marketsLayoutCss = `
.${MARKETS_LAYOUT_CLASS} {
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
.${MARKETS_LAYOUT_CLASS} [data-area="markets-head"] {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--mvp-spacing-md);
  flex-wrap: wrap;
}
.${MARKETS_LAYOUT_CLASS} [data-area="markets-head"] h1 {
  margin: 0;
  font-size: 1.5rem;
}
.${MARKETS_LAYOUT_CLASS} [data-area="markets-filter"] {
  display: flex;
  align-items: center;
  gap: var(--mvp-spacing-sm);
  flex-wrap: wrap;
  padding: var(--mvp-spacing-sm) var(--mvp-spacing-md);
  border: 1px solid var(--mvp-color-border);
  border-radius: var(--mvp-radius-sm);
  background: var(--mvp-color-surface-1);
  color: var(--mvp-color-text-muted);
}
.${MARKETS_LAYOUT_CLASS} [data-area="markets-table"] {
  border: 1px solid var(--mvp-color-border);
  border-radius: var(--mvp-radius-md);
  background: var(--mvp-color-surface-1);
  /* The table x-scrolls inside its own container so the page body never
     scrolls horizontally on narrow viewports (01 doc §5 responsive rule). */
  overflow-x: auto;
  min-width: 0;
}
.${MARKETS_LAYOUT_CLASS} [data-area="markets-table"] a {
  color: var(--mvp-color-accent);
}

/* Mobile < md (768px): collapse padding and let the filter bar wrap. */
@media (max-width: 767px) {
  .${MARKETS_LAYOUT_CLASS} {
    padding: var(--mvp-spacing-md);
    gap: var(--mvp-spacing-sm);
  }
}
`.trim();
