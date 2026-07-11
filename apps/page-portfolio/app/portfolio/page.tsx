import { FragmentSlotStream } from "@mvp/runtime/react";
import { headers } from "next/headers";
import { type ReactElement, type ReactNode, Suspense } from "react";
import {
  type PortfolioFragmentAggregate,
  type PortfolioSlotKey,
  streamPortfolioFragmentSlots,
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
}): ReactElement {
  return (
    <section data-fragment={fragment} data-fallback="true">
      {children}
    </section>
  );
}

// Fallback markup, defined once per slot and reused for both the Suspense
// loading placeholder and `<FragmentSlotStream>`'s own "resolved but empty"
// fallback — the same single fallback contract every existing test/e2e spec
// already anchors on (refactor plan §4.4: fallback semantics unchanged).
const PORTFOLIO_SUMMARY_FALLBACK = (
  <PanelFallback fragment="portfolio-summary">
    Portfolio summary is loading.
  </PanelFallback>
);
const PNL_CHART_FALLBACK = (
  <PanelFallback fragment="pnl-chart">PnL chart is loading.</PanelFallback>
);

/**
 * Scheduler health/hints + request-trace section (refactor plan §4.4). This
 * inherently needs the FULL aggregate result, so it can only resolve once
 * the slowest of the two slots does, same as before this refactor. It gets
 * its own async Server Component + `<Suspense>` boundary purely so it never
 * blocks the static shell or the two fragment slots from streaming ahead of
 * it; it still always settles last, which is correct, not a regression.
 */
async function SchedulerDiagnostics({
  aggregate,
}: {
  aggregate: Promise<PortfolioFragmentAggregate>;
}) {
  const diag = await aggregate;
  const diagnosticsList = Object.entries(diag.diagnostics) as [
    PortfolioSlotKey,
    (typeof diag.diagnostics)[PortfolioSlotKey],
  ][];

  return (
    <>
      {/* Scheduler health + hints (mirrors page-markets / page-trade
          diagnostics posture, simplified for this two-slot page). */}
      <section data-scheduler-health="portfolio">
        <h2>Scheduler health &amp; hints</h2>
        <p>
          Page health: <span data-field="health">{diag.scheduler.health}</span>
        </p>
        <ul data-field="slot-status">
          {diagnosticsList.map(([name, slotDiag]) => (
            <li key={name} data-slot={name}>
              {name}: {slotDiag.status}
              {slotDiag.required ? " (required)" : " (optional)"}
            </li>
          ))}
        </ul>
        <div data-field="scheduler-hints">
          {diag.scheduler.hints.length === 0 ? (
            <p data-hints="empty">No waterfall hints: the plan is optimal.</p>
          ) : (
            <ul>
              {diag.scheduler.hints.map((hint) => (
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
        <pre>{diag.traceLog}</pre>
      </section>
    </>
  );
}

export default async function PortfolioPage() {
  // No await before this point: the static shell below (heading, layout head,
  // holdings table header) needs nothing async and is the very first thing
  // flushed. `streamPortfolioFragmentSlots` itself is synchronous — it
  // returns a handle of promises immediately, it does not block (refactor
  // plan §4.4).
  const stream = streamPortfolioFragmentSlots({ headers: await headers() });

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
          <Suspense fallback={PORTFOLIO_SUMMARY_FALLBACK}>
            <FragmentSlotStream
              slotPromise={stream.slots.portfolioSummary}
              fallback={PORTFOLIO_SUMMARY_FALLBACK}
            />
          </Suspense>
        </div>

        {/* Cumulative PnL chart — ISR fragment (cache-friendly series). */}
        <div data-area="portfolio-chart" data-slot="pnlChart">
          <Suspense fallback={PNL_CHART_FALLBACK}>
            <FragmentSlotStream
              slotPromise={stream.slots.pnlChart}
              fallback={PNL_CHART_FALLBACK}
            />
          </Suspense>
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

      <Suspense fallback={null}>
        <SchedulerDiagnostics aggregate={stream.aggregate} />
      </Suspense>
    </main>
  );
}
