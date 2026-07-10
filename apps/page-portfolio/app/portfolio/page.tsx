import { FragmentSlot } from "@mvp/runtime/react";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import {
  fetchPortfolioFragmentSlots,
  type PortfolioSlotKey,
} from "../../src/fragmentSlots";
import { PORTFOLIO_LAYOUT_CLASS } from "../../src/gridStyles";
import { portfolioSeoCopy } from "../../src/render";

export const dynamic = "force-dynamic";

/** No-JS-readable fallback for a degraded/absent slot body. */
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

export default async function PortfolioPage() {
  const fragmentHtml = await fetchPortfolioFragmentSlots({
    headers: await headers(),
  });

  const diagnosticsList = Object.entries(fragmentHtml.diagnostics) as [
    PortfolioSlotKey,
    (typeof fragmentHtml.diagnostics)[PortfolioSlotKey],
  ][];

  return (
    <main data-page="portfolio">
      {/* SEO / no-JS readable heading — usable before any fragment resolves. */}
      <section data-portfolio-heading="portfolio">
        <h1>{portfolioSeoCopy.title}</h1>
        <p>{portfolioSeoCopy.description}</p>
      </section>

      {/* The portfolio layout: summary + PnL chart + holdings stacked.
          Region names match 01-ui-layout.md §4.4. */}
      <div className={PORTFOLIO_LAYOUT_CLASS}>
        <div data-area="portfolio-head">
          <h1>{portfolioSeoCopy.title}</h1>
        </div>

        {/* Overview: equity / margin usage / PnL — request-time SSR fragment. */}
        <div data-area="portfolio-summary" data-slot="portfolioSummary">
          <FragmentSlot
            name="portfolioSummary"
            execution={fragmentHtml.execution}
            fallback={
              <PanelFallback fragment="portfolio-summary">
                Portfolio summary is loading.
              </PanelFallback>
            }
          />
        </div>

        {/* Cumulative PnL chart — ISR fragment (cache-friendly series). */}
        <div data-area="portfolio-chart" data-slot="pnlChart">
          <FragmentSlot
            name="pnlChart"
            execution={fragmentHtml.execution}
            fallback={
              <PanelFallback fragment="pnl-chart">
                PnL chart is loading.
              </PanelFallback>
            }
          />
        </div>

        {/* Holdings: open positions. Inert, no-JS-readable table header today;
            a realtime patch island would enhance this in-place (future). */}
        <div data-area="portfolio-holdings">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Side</th>
                <th>Size</th>
                <th>Entry</th>
                <th>Mark</th>
                <th>uPnL</th>
              </tr>
            </thead>
            <tbody />
          </table>
        </div>
      </div>

      {/* Scheduler health + hints (mirrors page-markets / page-trade
          diagnostics posture, simplified for this two-slot page). */}
      <section data-scheduler-health="portfolio">
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
      </section>

      {/* Request trace (dependency-graph log), mirrors page-markets. */}
      <section data-request-trace="portfolio">
        <h2>Request trace</h2>
        <pre>{fragmentHtml.traceLog}</pre>
      </section>
    </main>
  );
}
