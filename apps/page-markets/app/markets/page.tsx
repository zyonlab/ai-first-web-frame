import { FragmentSlotStream } from "@mvp/runtime/react";
import { headers } from "next/headers";
import { Suspense } from "react";
import {
  type MarketsFragmentAggregate,
  type MarketsSlotKey,
  streamMarketsFragmentSlots,
} from "../../src/fragmentSlots";
import { MARKETS_LAYOUT_CLASS } from "../../src/gridStyles";
import { marketsSeoCopy } from "../../src/render";

export const dynamic = "force-dynamic";

// Fallback markup, defined once per slot and reused for both the Suspense
// loading placeholder and `<FragmentSlotStream>`'s own "resolved but empty"
// fallback — the same single fallback contract every existing test/e2e spec
// already anchors on (refactor plan §4.4: fallback semantics unchanged).
const MARKETS_TABLE_FALLBACK = (
  <section data-fragment="markets-table" data-fallback="true">
    Markets table is loading.
  </section>
);

/**
 * Scheduler health/hints + request-trace section (refactor plan §4.4). This
 * inherently needs the FULL aggregate result, so it can only resolve once
 * the (single) slot's own node finishes, same as before this refactor. It
 * gets its own async Server Component + `<Suspense>` boundary purely so it
 * never blocks the static shell or the fragment slot from streaming ahead of
 * it; it still always settles last, which is correct, not a regression.
 */
async function SchedulerDiagnostics({
  aggregate,
}: {
  aggregate: Promise<MarketsFragmentAggregate>;
}) {
  const diag = await aggregate;
  const diagnosticsList = Object.entries(diag.diagnostics) as [
    MarketsSlotKey,
    (typeof diag.diagnostics)[MarketsSlotKey],
  ][];

  return (
    <>
      {/* Scheduler health + hints (mirrors page-trade / page-home diagnostics
          posture, simplified for the single-slot page). */}
      <section data-scheduler-health="markets">
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

      {/* Request trace (dependency-graph log), mirrors page-trade. */}
      <section data-request-trace="markets">
        <h2>Request trace</h2>
        <pre>{diag.traceLog}</pre>
      </section>
    </>
  );
}

export default async function MarketsPage() {
  // No await before this point: the static shell below (heading, layout head,
  // filter bar) needs nothing async and is the very first thing flushed.
  // `streamMarketsFragmentSlots` itself is synchronous — it returns a handle
  // of promises immediately, it does not block (refactor plan §4.4).
  const stream = streamMarketsFragmentSlots({ headers: await headers() });

  return (
    <main data-page="markets">
      {/* SEO / no-JS readable heading — usable before any fragment resolves. */}
      <section data-markets-heading="markets">
        <h1>{marketsSeoCopy.title}</h1>
        <p>{marketsSeoCopy.description}</p>
      </section>

      {/* The markets layout: header + filter bar stacked above the table body.
          Region names match 01-ui-layout.md §5. */}
      <div className={MARKETS_LAYOUT_CLASS}>
        <div data-area="markets-head">
          <h1>{marketsSeoCopy.title}</h1>
        </div>

        {/* Client sort/filter would enhance this bar (small island, future);
            it is inert and readable server-side today. */}
        <div data-area="markets-filter">
          <span data-filter="search">Search</span>
          <span data-filter="type">All</span>
          <span data-filter="product">Perps</span>
          <span data-filter="starred">Starred only</span>
        </div>

        <div data-area="markets-table" data-slot="marketsTable">
          <Suspense fallback={MARKETS_TABLE_FALLBACK}>
            <FragmentSlotStream
              slotPromise={stream.slots.marketsTable}
              fallback={MARKETS_TABLE_FALLBACK}
            />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={null}>
        <SchedulerDiagnostics aggregate={stream.aggregate} />
      </Suspense>
    </main>
  );
}
