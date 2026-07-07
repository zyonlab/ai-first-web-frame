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

type TradePageProps = {
  params: Promise<{ symbol: string }>;
};

export default async function TradePage({ params }: TradePageProps) {
  const { symbol: rawSymbol } = await params;
  const symbol = normalizeSymbol(rawSymbol);
  const fragmentHtml = await fetchTradeFragmentSlots({
    symbol,
    headers: await headers(),
  });
  const slots = fragmentHtml.slots;

  const diagnosticsList = Object.entries(fragmentHtml.diagnostics) as [
    TradeSlotKey,
    (typeof fragmentHtml.diagnostics)[TradeSlotKey],
  ][];

  return (
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
          {/* marketrail fragment is not built yet — mount in P3 follow-up. */}
          <PanelFallback fragment="marketrail">
            Watchlist rail — mount marketrail fragment in P3 follow-up.
          </PanelFallback>
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
            <p data-hints="empty">No waterfall hints: the plan is optimal.</p>
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
          account data reads: {fragmentHtml.dataDiagnostics.account.firstRead} /{" "}
          {fragmentHtml.dataDiagnostics.account.secondRead}
        </p>
      </section>

      {/* Request trace (dependency-graph log), mirrors page-home. */}
      <section data-request-trace="trade">
        <h2>Request trace</h2>
        <pre>{fragmentHtml.traceLog}</pre>
      </section>
    </main>
  );
}
