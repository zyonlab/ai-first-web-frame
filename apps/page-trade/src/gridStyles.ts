/**
 * Trade terminal grid CSS (contract source: docs/trade-demo/01-ui-layout.md §1.2
 * grid-template-areas + §2 responsive matrix). The page shell owns the grid;
 * each named area is filled by one fragment's SSR HTML.
 *
 * All widths come from the frozen `@mvp/design-system` grid track tokens
 * (`--mvp-grid-rail` / `--mvp-grid-book` / `--mvp-grid-form`) and all colors from
 * the semantic color tokens (`--mvp-color-*`) — no hard-coded pixels for tracks
 * and no hard-coded hex colors (spine §13 / CLAUDE.md hard rule).
 *
 * Emitted as a plain string so the RSC page can inject it once via a `<style>`
 * tag and tests can assert the named grid areas exist without a browser.
 */
export const TRADE_GRID_CLASS = "trade-grid" as const;

export const tradeGridCss = `
.${TRADE_GRID_CLASS} {
  display: grid;
  grid-template-columns:
    var(--mvp-grid-rail)
    minmax(340px, 1fr)
    var(--mvp-grid-book)
    var(--mvp-grid-form);
  grid-template-rows:
    auto
    1fr
    minmax(160px, 22vh)
    auto
    auto;
  grid-template-areas:
    "header header  header  header"
    "rail   chart   book    form"
    "rail   trades  book    form"
    "ledger ledger  ledger  ledger"
    "status status  status  status";
  gap: var(--mvp-spacing-xs);
  min-height: 100dvh;
  background: var(--mvp-color-surface-0);
  color: var(--mvp-color-ink);
  padding: var(--mvp-spacing-xs);
  box-sizing: border-box;
}
.${TRADE_GRID_CLASS} [data-area] {
  border: 1px solid var(--mvp-color-border);
  border-radius: var(--mvp-radius-sm);
  background: var(--mvp-color-surface-1);
  overflow: auto;
  min-width: 0;
  min-height: 0;
}
.${TRADE_GRID_CLASS} [data-area="rail"] { grid-area: rail; }
.${TRADE_GRID_CLASS} [data-area="header"] { grid-area: header; }
.${TRADE_GRID_CLASS} [data-area="chart"] { grid-area: chart; }
.${TRADE_GRID_CLASS} [data-area="book"] { grid-area: book; }
.${TRADE_GRID_CLASS} [data-area="trades"] { grid-area: trades; }
.${TRADE_GRID_CLASS} [data-area="form"] {
  grid-area: form;
  display: grid;
  grid-template-rows: 1fr auto;
  gap: var(--mvp-spacing-xs);
  border: 0;
  background: transparent;
  overflow: visible;
}
.${TRADE_GRID_CLASS} [data-area="ledger"] {
  grid-area: ledger;
  overflow-x: auto;
}
.${TRADE_GRID_CLASS} [data-area="status"] {
  grid-area: status;
  color: var(--mvp-color-text-muted);
  font: var(--mvp-font-mono);
}
/* Order form column stacks the order-form (top) and account-bar (foot). */
.${TRADE_GRID_CLASS} [data-slot="orderForm"],
.${TRADE_GRID_CLASS} [data-slot="accountBar"] {
  border: 1px solid var(--mvp-color-border);
  border-radius: var(--mvp-radius-sm);
  background: var(--mvp-color-surface-1);
  overflow: auto;
}
/* Ledger holds the positions + open-orders tables side by side, each x-scrolls
   inside its own container so the page body never scrolls horizontally. */
.${TRADE_GRID_CLASS} .trade-ledger-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--mvp-spacing-xs);
}
.${TRADE_GRID_CLASS} .trade-ledger-tabs > * { overflow-x: auto; min-width: 0; }

/* Tablet md–lg (768–1023px): two columns, book/trades/form become a right
   stack; the persistent rail collapses (01 doc §2.2). */
@media (max-width: 1023px) {
  .${TRADE_GRID_CLASS} {
    grid-template-columns: minmax(320px, 1fr) var(--mvp-grid-book);
    grid-template-rows: auto 1fr minmax(160px, 22vh) auto auto auto;
    grid-template-areas:
      "header header"
      "chart  book"
      "trades book"
      "form   form"
      "ledger ledger"
      "status status";
  }
  .${TRADE_GRID_CLASS} [data-area="rail"] { display: none; }
}

/* Mobile < md (768px): single column, tab-folded (01 doc §2.3). */
@media (max-width: 767px) {
  .${TRADE_GRID_CLASS} {
    grid-template-columns: 1fr;
    grid-template-areas:
      "header"
      "chart"
      "book"
      "trades"
      "form"
      "ledger"
      "status";
  }
  .${TRADE_GRID_CLASS} [data-area="rail"] { display: none; }
  .${TRADE_GRID_CLASS} .trade-ledger-tabs { grid-template-columns: 1fr; }
}

/* No-JS/SEO heading kept in the DOM for accessibility + crawlers but visually
   hidden: the sticky market-header bar (symbol + mark/oracle/funding) is the
   terminal's on-screen title, so a second visible <h1> is just a storefront
   billboard that orphaned itself above the grid. */
[data-trade-heading] {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
`.trim();
