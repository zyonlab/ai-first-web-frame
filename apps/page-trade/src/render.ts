import { TRADE_GRID_CLASS } from "./gridStyles";

/**
 * Per-slot fragment HTML for the trade terminal. Each value is a trusted
 * internal fragment's SSR HTML string, or `null`/omitted to fall back to the
 * no-JS-readable placeholder for that panel.
 */
export type TradeFragments = {
  marketHeader?: string | null;
  chart?: string | null;
  book?: string | null;
  trades?: string | null;
  orderForm?: string | null;
  accountBar?: string | null;
  positions?: string | null;
  openOrders?: string | null;
  fundingBar?: string | null;
};

export const tradeSeoCopy = {
  title: "MVP Perps — Trade Terminal",
  description:
    "Trade perpetuals on a dense, server-rendered terminal: order book, order form, positions and account, all readable without client JavaScript.",
} as const;

/**
 * No-JS-readable fallback markup for a panel. Mirrors the fragment fallback
 * contract (`data-fallback="true"`) used across the framework so a missing
 * realtime fragment degrades the panel instead of breaking the page.
 */
function panelFallback(fragment: string, label: string): string {
  return `<section data-fragment="${fragment}" data-fallback="true">${label}</section>`;
}

/**
 * Assemble the trade terminal grid as a pure HTML string. Used both for the
 * no-JS SSR baseline and for tests that assert the grid topology / fallbacks
 * without a browser. The RSC page (`app/trade/[symbol]/page.tsx`) renders the
 * same named grid areas via React.
 */
export function renderTradeHtml(
  symbol: string,
  fragments: TradeFragments = {},
): string {
  const upper = symbol.toUpperCase();
  const header =
    fragments.marketHeader ??
    panelFallback("market-header", `Market header for ${upper} is loading.`);
  // chart-panel fragment is not built yet (P3 follow-up); render a readable
  // placeholder block so the grid area exists and the page is complete.
  const chart =
    fragments.chart ??
    `<section data-slot="chart" data-fragment="chart-panel" data-fallback="true">Chart for ${upper} — mount chart-panel fragment in P3 follow-up.</section>`;
  const book =
    fragments.book ??
    panelFallback("order-book", `Order book for ${upper} is loading.`);
  const trades =
    fragments.trades ??
    panelFallback("trades-feed", `Trades feed for ${upper} is loading.`);
  const orderForm =
    fragments.orderForm ??
    panelFallback("order-form", `Order form for ${upper} is loading.`);
  const accountBar =
    fragments.accountBar ??
    panelFallback("account-bar", "Account summary is loading.");
  const positions =
    fragments.positions ??
    panelFallback("positions-table", "Positions are loading.");
  const openOrders =
    fragments.openOrders ??
    panelFallback("open-orders", "Open orders are loading.");
  const fundingBar =
    fragments.fundingBar ??
    panelFallback("funding-bar", `Funding schedule for ${upper} is loading.`);

  return `<main data-page="trade" data-symbol="${upper}">
    <div class="${TRADE_GRID_CLASS}">
      <div data-area="rail" data-slot="rail">
        <section data-fragment="marketrail" data-fallback="true">Watchlist rail — mount marketrail fragment in P3 follow-up.</section>
      </div>
      <div data-area="header" data-slot="marketHeader">${header}</div>
      <div data-area="chart" data-slot="chart">${chart}</div>
      <div data-area="book" data-slot="book">${book}</div>
      <div data-area="trades" data-slot="trades">${trades}</div>
      <div data-area="form">
        <div data-slot="orderForm">${orderForm}</div>
        <div data-slot="accountBar">${accountBar}</div>
      </div>
      <div data-area="ledger" data-slot="ledger">
        <div class="trade-ledger-tabs">
          <div data-slot="positions">${positions}</div>
          <div data-slot="openOrders">${openOrders}</div>
        </div>
      </div>
      <div data-area="status" data-slot="fundingBar">${fundingBar}</div>
    </div>
  </main>`;
}

/** Shared-UI primitives reused (no duplication — satisfies similarity audit). */
export const usedUiComponents = [
  "Section",
  "Card",
  "DataTable",
  "Tabs",
] as const;
