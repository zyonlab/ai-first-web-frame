import { FragmentSlotStream, PageHealthMetaStream } from "@mvp/runtime/react";
import { isDiagnosticsEnabled } from "@mvp/runtime/seo";
import { headers } from "next/headers";
import { Suspense } from "react";
import {
  type MarketsFragmentAggregate,
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
          {Object.entries(diag.diagnostics).map(([name, slotDiag]) => (
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

        {/*
          `stream.slotPromises` is `Record<string, Promise<FragmentRenderResponse>>`
          (@mvp/runtime's own generic shape — see fragmentSlots.ts). Dot access
          below still type-checks (this repo's tsconfig does not set
          `noPropertyAccessFromIndexSignature`) and is what biome's
          `useLiteralKeys` lint rule expects, so it is kept — the generic type
          already removes the hand-maintained per-slot TypeScript interface;
          switching to bracket notation here would be cosmetic, not
          functional. WHICH slots get their own <Suspense> boundary and what
          fallback markup they show remains genuine human judgment (A1's
          explicit carve-out), not something codegen can decide: mounting a
          new slot never requires touching fragmentSlots.ts, but wiring it
          into this JSX (a new <Suspense><FragmentSlotStream/></Suspense>
          block) is the one deliberate hand-edit A1 carves out.
        */}
        <div data-area="markets-table" data-slot="marketsTable">
          <Suspense fallback={MARKETS_TABLE_FALLBACK}>
            <FragmentSlotStream
              slotPromise={stream.slotPromises.marketsTable}
              fallback={MARKETS_TABLE_FALLBACK}
            />
          </Suspense>
        </div>
      </div>

      {/*
        Aggregate health as a hidden marker the shell gateway reads, so a page whose
        REQUIRED slot is down answers 503 instead of a 200 full of degraded
        markup (Tailor's `primary` semantic — see PAGE_HEALTH_ATTR in
        @mvp/runtime). Own Suspense boundary: it needs the full aggregate, and
        must never delay the shell or the slots.
      */}
      <Suspense fallback={null}>
        <PageHealthMetaStream execution={stream.execution} />
      </Suspense>
      {/*
        Internal diagnostics (scheduler health, per-slot strategy/source, the
        request-trace dependency graph) are DEV/E2E affordances, not page
        content: they used to render unconditionally, putting internal timings
        and topology into every production response as visible <h2> sections.
        `isDiagnosticsEnabled()` keeps them on outside production and requires
        an explicit MVP_DIAGNOSTICS=on in production — which the compose stack
        sets, so the e2e and runtime-gate assertions still see them.
      */}
      {isDiagnosticsEnabled() && (
        <Suspense fallback={null}>
          <SchedulerDiagnostics aggregate={stream.aggregate} />
        </Suspense>
      )}
    </main>
  );
}
