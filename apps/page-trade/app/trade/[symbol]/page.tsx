import { readThemePreference, resolveLocalePreference } from "@mvp/storage";
import { AppNav } from "@mvp/ui/AppNav";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import {
  fetchTradeFragmentSlots,
  normalizeSymbol,
  type TradeSlotKey,
} from "../../../src/fragmentSlots";
import { TRADE_GRID_CLASS } from "../../../src/gridStyles";
import { TradeHydrator } from "../../../src/hydrate";
import { tradeSeoCopy } from "../../../src/render";

export const dynamic = "force-dynamic";

function FragmentHtml({
  html,
  fallback,
}: {
  html: string | null;
  fallback: ReactNode;
}) {
  if (!html) return fallback;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: fragment HTML is returned by trusted internal SSR fragment services (registry serviceUrl), never user input.
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/** No-JS-readable fallback for a degraded/absent panel. */
function PanelFallback({
  fragment,
  children,
}: {
  fragment: string;
  children: ReactNode;
}) {
  return (
    <section data-fragment={fragment} data-fallback="true">
      {children}
    </section>
  );
}

/**
 * Compact markets watchlist filling the persistent left rail. Rendered by the
 * page (not a fragment yet — the `marketrail` fragment is a P3 follow-up), each
 * row is a plain `<a>` so the rail is fully navigable with no client JS. The
 * mock quotes are static demo data; live ticking arrives with the fragment.
 */
const RAIL_WATCHLIST = [
  { symbol: "BTC", price: "62,999.0", change: -0.05 },
  { symbol: "ETH", price: "3,090.4", change: 0.42 },
  { symbol: "SOL", price: "147.20", change: 1.83 },
  { symbol: "ARB", price: "0.9820", change: -1.21 },
  { symbol: "DOGE", price: "0.16200", change: 0.64 },
  { symbol: "AVAX", price: "38.400", change: -0.33 },
  { symbol: "LINK", price: "17.850", change: 2.1 },
  { symbol: "OP", price: "2.4100", change: -0.88 },
  { symbol: "APT", price: "9.6200", change: 0.15 },
  { symbol: "SUI", price: "1.8400", change: 3.02 },
] as const;

function RailWatchlist({ active }: { active: string }) {
  return (
    <nav className="rail-watchlist" aria-label="Markets watchlist">
      <div className="rail-watchlist__head">
        <span>Markets</span>
        <span className="rail-watchlist__col">Last</span>
      </div>
      <ul className="rail-watchlist__list">
        {RAIL_WATCHLIST.map((m) => (
          <li key={m.symbol}>
            <a
              className="rail-watchlist__row"
              href={`/trade/${m.symbol}`}
              aria-current={m.symbol === active ? "page" : undefined}
            >
              <span className="rail-watchlist__sym">{m.symbol}</span>
              <span className="rail-watchlist__price">{m.price}</span>
              <span
                className={`rail-watchlist__chg rail-watchlist__chg--${
                  m.change >= 0 ? "up" : "down"
                }`}
              >
                {m.change >= 0 ? "+" : ""}
                {m.change.toFixed(2)}%
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

type TradePageProps = {
  params: Promise<{ symbol: string }>;
};

export default async function TradePage({ params }: TradePageProps) {
  const { symbol: rawSymbol } = await params;
  const symbol = normalizeSymbol(rawSymbol);
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get("cookie") ?? "";
  // The trade page owns its own theme/locale + nav (rendered inside its React
  // tree) so hydration stays byte-consistent (no React #418). currentPath +
  // lastSymbol deep-link Trade to the active symbol.
  // Terminal defaults to dark (matches the layout's data-theme resolution) so
  // the nav's theme control reflects the actually-rendered canvas.
  const theme =
    readThemePreference(cookieHeader) === "light" ? "light" : "dark";
  const locale = resolveLocalePreference({ cookieHeader });
  const fragmentHtml = await fetchTradeFragmentSlots({
    symbol,
    headers: requestHeaders,
  });
  const slots = fragmentHtml.slots;

  const diagnosticsList = Object.entries(fragmentHtml.diagnostics) as [
    TradeSlotKey,
    (typeof fragmentHtml.diagnostics)[TradeSlotKey],
  ][];

  return (
    <>
      <AppNav
        currentPath={`/trade/${symbol}`}
        theme={theme}
        locale={locale}
        lastSymbol={symbol}
      />
      <main data-page="trade" data-symbol={symbol}>
        {/* SEO / no-JS readable heading — usable before any island hydrates. */}
        <section data-trade-heading="trade">
          <h1>
            {tradeSeoCopy.title} — {symbol}
          </h1>
          <p>{tradeSeoCopy.description}</p>
        </section>

        {/* The trade terminal grid. Named areas match 01-ui-layout.md §1.2. Each
          area is filled by one trusted internal fragment's SSR HTML. */}
        <div className={TRADE_GRID_CLASS}>
          <div data-area="rail" data-slot="rail">
            <RailWatchlist active={symbol} />
          </div>

          <div data-area="header" data-slot="marketHeader">
            <FragmentHtml
              html={slots.marketHeader}
              fallback={
                <PanelFallback fragment="market-header">
                  Market header for {symbol} is loading.
                </PanelFallback>
              }
            />
          </div>

          <div data-area="chart" data-slot="chart">
            <FragmentHtml
              html={slots.chart}
              fallback={
                <PanelFallback fragment="chart-panel">
                  Chart for {symbol} is loading.
                </PanelFallback>
              }
            />
          </div>

          <div data-area="book" data-slot="book">
            <FragmentHtml
              html={slots.book}
              fallback={
                <PanelFallback fragment="order-book">
                  Order book for {symbol} is loading.
                </PanelFallback>
              }
            />
          </div>

          <div data-area="trades" data-slot="trades">
            <FragmentHtml
              html={slots.trades}
              fallback={
                <PanelFallback fragment="trades-feed">
                  Trades feed for {symbol} is loading.
                </PanelFallback>
              }
            />
          </div>

          {/* Order-form column: order-form on top, account-bar docked at foot. */}
          <div data-area="form">
            <div data-slot="orderForm">
              <FragmentHtml
                html={slots.orderForm}
                fallback={
                  <PanelFallback fragment="order-form">
                    Order form for {symbol} is loading.
                  </PanelFallback>
                }
              />
            </div>
            <div data-slot="accountBar">
              <FragmentHtml
                html={slots.accountBar}
                fallback={
                  <PanelFallback fragment="account-bar">
                    Account summary is loading.
                  </PanelFallback>
                }
              />
            </div>
          </div>

          {/* Ledger: positions + open-orders tables, each x-scrolls internally. */}
          <div data-area="ledger" data-slot="ledger">
            <div className="trade-ledger-tabs">
              <div data-slot="positions">
                <FragmentHtml
                  html={slots.positions}
                  fallback={
                    <PanelFallback fragment="positions-table">
                      Positions are loading.
                    </PanelFallback>
                  }
                />
              </div>
              <div data-slot="openOrders">
                <FragmentHtml
                  html={slots.openOrders}
                  fallback={
                    <PanelFallback fragment="open-orders">
                      Open orders are loading.
                    </PanelFallback>
                  }
                />
              </div>
            </div>
          </div>

          <div data-area="status" data-slot="fundingBar">
            <FragmentHtml
              html={slots.fundingBar}
              fallback={
                <PanelFallback fragment="funding-bar">
                  Funding schedule for {symbol} is loading.
                </PanelFallback>
              }
            />
          </div>
        </div>

        {/* Client hydration boundary: mounts the four React islands into their
          SSR `[data-island]` nodes against the page-owned shared store and wires
          the order-book → order-form price flow. Renders nothing itself. */}
        <TradeHydrator />

        {/* Framework observability showcase (scheduler plan + request trace),
            collapsed so the terminal stays a clean one-screen hero. Native
            <details> keeps the content in the DOM (no JS) for tests + no-JS. */}
        <details className="trade-diagnostics">
          <summary>
            Framework diagnostics — scheduler health &amp; request trace
          </summary>
          {/* Scheduler health + hints (mirrors page-home diagnostics posture). */}
          <section data-scheduler-health="trade">
            <h2>Scheduler health &amp; hints</h2>
            <p>
              Page health:{" "}
              <span data-field="health">{fragmentHtml.scheduler.health}</span>
            </p>
            <ul data-field="slot-status">
              {diagnosticsList.map(([name, diag]) => (
                <li key={name} data-slot={name}>
                  {name}: {diag.status}
                  {diag.required ? " (required)" : " (optional)"}
                </li>
              ))}
            </ul>
            <div data-field="scheduler-hints">
              {fragmentHtml.scheduler.hints.length === 0 ? (
                <p data-hints="empty">
                  No waterfall hints: the plan is optimal.
                </p>
              ) : (
                <ul>
                  {fragmentHtml.scheduler.hints.map((hint) => (
                    <li
                      key={`${hint.kind}:${hint.slots.join(",")}`}
                      data-hint={hint.kind}
                    >
                      {hint.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p data-field="account-dedupe">
              account data reads:{" "}
              {fragmentHtml.dataDiagnostics.account.firstRead} /{" "}
              {fragmentHtml.dataDiagnostics.account.secondRead}
            </p>
          </section>

          {/* Request trace (dependency-graph log), mirrors page-home. */}
          <section data-request-trace="trade">
            <h2>Request trace</h2>
            <pre>{fragmentHtml.traceLog}</pre>
          </section>
        </details>
      </main>
    </>
  );
}
