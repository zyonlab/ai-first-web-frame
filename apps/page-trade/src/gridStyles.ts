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
    minmax(0, max-content)
    minmax(140px, 1fr)
    minmax(120px, 200px)
    auto;
  grid-template-areas:
    "header header  header  header"
    "rail   chart   book    form"
    "rail   chart   trades  form"
    "ledger ledger  ledger  ledger"
    "status status  status  status";
  gap: var(--mvp-spacing-xs);
  height: 100dvh;
  overflow: hidden;
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
  display: flex;
  flex-direction: column;
}
/* The single fragment in each pane fills it, so dense panels reach the pane
   edges instead of stranding their content above a fixed-size void. */
.${TRADE_GRID_CLASS} [data-area] > * {
  flex: 1 1 auto;
  min-height: 0;
}
/* Dark, thin scrollbars so the default light OS scrollbar never breaks the
   terminal in scrolling panes (trades tape, book, ledger). */
.${TRADE_GRID_CLASS} * {
  scrollbar-width: thin;
  scrollbar-color: var(--mvp-color-border) transparent;
}
.${TRADE_GRID_CLASS} *::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.${TRADE_GRID_CLASS} *::-webkit-scrollbar-track {
  background: transparent;
}
.${TRADE_GRID_CLASS} *::-webkit-scrollbar-thumb {
  background: var(--mvp-color-border);
  border-radius: 4px;
}
.${TRADE_GRID_CLASS} *::-webkit-scrollbar-thumb:hover {
  background: var(--mvp-color-text-muted);
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
    grid-template-rows: auto minmax(320px, 1.6fr) minmax(220px, 1fr) auto auto auto;
    grid-template-areas:
      "header header"
      "chart  book"
      "chart  trades"
      "form   form"
      "ledger ledger"
      "status status";
    height: auto;
    overflow: visible;
  }
  .${TRADE_GRID_CLASS} [data-area="rail"] { display: none; }
}

/* Mobile < md (768px): single column, tab-folded (01 doc §2.3). */
@media (max-width: 767px) {
  .${TRADE_GRID_CLASS} {
    grid-template-columns: 1fr;
    grid-template-rows: auto 320px 240px 220px auto auto auto;
    grid-template-areas:
      "header"
      "chart"
      "book"
      "trades"
      "form"
      "ledger"
      "status";
    height: auto;
    overflow: visible;
  }
  .${TRADE_GRID_CLASS} [data-area="rail"] { display: none; }
  .${TRADE_GRID_CLASS} .trade-ledger-tabs { grid-template-columns: 1fr; }
}

/* Left-rail markets watchlist (page-rendered until the marketrail fragment
   lands). Fills the persistent rail; rows are plain <a>s so the rail is fully
   navigable with no client JS. */
.rail-watchlist {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-family: var(--mvp-font-mono);
  font-variant-numeric: tabular-nums;
}
.rail-watchlist__head {
  display: flex;
  justify-content: space-between;
  padding: 6px 8px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--mvp-color-text-muted);
  border-bottom: 1px solid var(--mvp-color-border);
  position: sticky;
  top: 0;
  background: var(--mvp-color-surface-1);
}
.rail-watchlist__list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  min-height: 0;
}
.rail-watchlist__row {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas: "sym price" "sym chg";
  column-gap: 8px;
  align-items: center;
  padding: 5px 8px;
  font-size: 12px;
  color: var(--mvp-color-ink);
  border-bottom: 1px solid
    color-mix(in srgb, var(--mvp-color-border) 50%, transparent);
}
.rail-watchlist__row:hover {
  background: color-mix(in srgb, var(--mvp-color-ink) 6%, transparent);
}
.rail-watchlist__row[aria-current="page"] {
  background: var(--mvp-color-surface-2);
  box-shadow: inset 2px 0 0 0 var(--mvp-color-accent);
}
.rail-watchlist__sym {
  grid-area: sym;
  font-weight: 600;
}
.rail-watchlist__price {
  grid-area: price;
  text-align: right;
}
.rail-watchlist__chg {
  grid-area: chg;
  text-align: right;
  font-size: 10px;
}
.rail-watchlist__chg--up {
  color: var(--mvp-color-up);
}
.rail-watchlist__chg--down {
  color: var(--mvp-color-down);
}

/* Framework-observability drawer: a bottom-docked request-trace waterfall.
   Native <details> — the summary is a floating pill tab; opening slides up a
   fixed bottom panel over the 100dvh terminal. No client JS. */
.trace-drawer {
  font-family: var(--mvp-font-mono);
  font-size: 11px;
}
.trace-drawer > summary {
  position: fixed;
  right: var(--mvp-spacing-sm);
  bottom: var(--mvp-spacing-sm);
  z-index: var(--mvp-zIndex-overlay, 1000);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--mvp-color-surface-2);
  border: 1px solid var(--mvp-color-border);
  border-radius: 999px;
  color: var(--mvp-color-text-muted);
  cursor: pointer;
  list-style: none;
  user-select: none;
  box-shadow: 0 2px 12px rgb(0 0 0 / 0.4);
}
.trace-drawer > summary::-webkit-details-marker {
  display: none;
}
.trace-drawer > summary:hover {
  color: var(--mvp-color-ink);
}
.trace-drawer[open] > summary {
  z-index: calc(var(--mvp-zIndex-overlay, 1000) + 2);
  background: var(--mvp-color-surface-1);
}
.trace-drawer__tab-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--mvp-color-buy);
}
.trace-drawer__tab-dot[data-health="degraded"] {
  background: var(--mvp-color-signal);
}
.trace-drawer__tab-dot[data-health="unhealthy"] {
  background: var(--mvp-color-sell);
}
.trace-drawer__panel {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: min(46vh, 460px);
  z-index: calc(var(--mvp-zIndex-overlay, 1000) + 1);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px 16px;
  background: var(--mvp-color-surface-1);
  border-top: 1px solid var(--mvp-color-border);
  box-shadow: 0 -8px 30px rgb(0 0 0 / 0.5);
  overflow: auto;
  animation: trace-drawer-in 160ms ease-out;
}
@keyframes trace-drawer-in {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
.trace-drawer__head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  color: var(--mvp-color-ink);
}
.trace-drawer__head strong {
  font-size: 12px;
}
.trace-drawer__meta {
  color: var(--mvp-color-text-muted);
}
.trace-drawer__health[data-health="ok"] {
  color: var(--mvp-color-buy);
}
.trace-drawer__health[data-health="degraded"] {
  color: var(--mvp-color-signal);
}
.trace-drawer__health[data-health="unhealthy"] {
  color: var(--mvp-color-sell);
}
.trace-drawer__legend {
  display: inline-flex;
  gap: 12px;
  margin-left: auto;
  color: var(--mvp-color-text-muted);
}
.trace-drawer__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* Waterfall: label column + a proportional time track per span. */
.trace-wf {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.trace-wf__axis {
  display: flex;
  justify-content: space-between;
  margin-left: 220px;
  padding-bottom: 2px;
  color: var(--mvp-color-text-muted);
  font-size: 10px;
  border-bottom: 1px solid var(--mvp-color-border);
}
.trace-wf__rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.trace-wf__row {
  display: grid;
  grid-template-columns: 220px 1fr;
  align-items: center;
  height: 20px;
}
.trace-wf__row:hover {
  background: color-mix(in srgb, var(--mvp-color-ink) 5%, transparent);
}
.trace-wf__label {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
}
.trace-wf__name {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--mvp-color-ink);
}
.trace-wf__dot {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  flex: none;
  background: var(--mvp-color-text-muted);
}
.trace-wf__track {
  position: relative;
  height: 14px;
}
.trace-wf__bar {
  position: absolute;
  top: 2px;
  height: 10px;
  min-width: 2px;
  border-radius: 2px;
  background: var(--mvp-color-text-muted);
}
.trace-wf__dot[data-kind="request"],
.trace-wf__bar[data-kind="request"] {
  background: var(--mvp-color-accent);
}
.trace-wf__dot[data-kind="network"],
.trace-wf__bar[data-kind="network"] {
  background: var(--mvp-color-signal);
}
.trace-wf__dot[data-kind="fragment"],
.trace-wf__bar[data-kind="fragment"] {
  background: var(--mvp-color-buy);
}
.trace-wf__bar[data-status="error"] {
  background: var(--mvp-color-sell);
}
.trace-wf__dur {
  position: absolute;
  top: 0;
  padding-left: 4px;
  line-height: 14px;
  font-size: 10px;
  white-space: nowrap;
  color: var(--mvp-color-text-muted);
}
.trace-drawer__hints strong {
  font-size: 11px;
  color: var(--mvp-color-ink);
}
.trace-drawer__hints ul {
  margin: 4px 0 0;
  padding-left: 1.1em;
  color: var(--mvp-color-text-muted);
}
.trace-drawer__hints li {
  margin: 2px 0;
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
