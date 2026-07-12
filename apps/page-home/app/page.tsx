import { FragmentSlotStream } from "@mvp/runtime/react";
import { headers } from "next/headers";
import { Suspense } from "react";
import {
  type HomeFragmentAggregate,
  streamHomeFragmentSlots,
} from "../src/fragmentSlots";
import { computeRealtimeSnapshot } from "../src/realtimeInsights";
import { homeSeoCopy } from "../src/render";
import { RealtimeInsights } from "./RealtimeInsights";

export const dynamic = "force-dynamic";

// Fallback markup, defined once per slot and reused for both the Suspense
// loading placeholder and `<FragmentSlotStream>`'s own "resolved but empty"
// fallback — the same single fallback contract every existing test/e2e spec
// already anchors on (refactor plan §4.4: fallback semantics unchanged).
const STATIC_EDITORIAL_FALLBACK = (
  <section data-fragment="static-editorial-note" data-fallback="true">
    Static editorial is unavailable.
  </section>
);
const PROMOTION_FALLBACK = (
  <section data-fragment="promotion-banner" data-fallback="true">
    Featured offers are loading.
  </section>
);
const RECOMMENDATIONS_FALLBACK = (
  <section data-fragment="recommendation-widget" data-fallback="true">
    Recommendations are loading.
  </section>
);

/**
 * Diagnostics/scheduler-health/trace-log section (refactor plan §4.4). This
 * inherently needs the FULL aggregate result — every slot's status, every
 * data dependency — so it can only resolve once the slowest slot does, same
 * as before this refactor. It gets its own async Server Component +
 * `<Suspense>` boundary purely so it never blocks the static shell or the
 * three fragment slots from streaming ahead of it; it still always settles
 * last, which is correct, not a regression.
 */
async function SchedulerDiagnostics({
  aggregate,
}: {
  aggregate: Promise<HomeFragmentAggregate>;
}) {
  const diag = await aggregate;
  return (
    <>
      <section data-scheduler-health="home">
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
      <section data-render-strategies="home">
        <h2>Render strategy samples</h2>
        <ul>
          <li>static: {diag.diagnostics.staticEditorial.source}</li>
          <li>cached-ssr: {diag.diagnostics.promotion.source}</li>
          <li>dynamic-ssr: {diag.diagnostics.recommendations.source}</li>
          <li>
            data dedupe: {diag.dataDiagnostics.featuredContent.firstRead} /{" "}
            {diag.dataDiagnostics.featuredContent.secondRead}
          </li>
        </ul>
      </section>
      <section data-request-trace="home">
        <h2>Request trace</h2>
        <pre>{diag.traceLog}</pre>
      </section>
    </>
  );
}

export default async function HomePage() {
  // No await before this point: the static shell below (title, description,
  // no-JS readable copy) needs nothing async and is the very first thing
  // flushed. `streamHomeFragmentSlots` itself is synchronous — it returns a
  // handle of promises immediately, it does not block (refactor plan §4.4).
  const stream = streamHomeFragmentSlots({ headers: await headers() });
  // Deterministic SSR first paint for the realtime island: readable with no JS.
  const initialSnapshot = computeRealtimeSnapshot("all", 0);

  return (
    <main data-page="home">
      <section>
        <h1>{homeSeoCopy.title}</h1>
        <p>{homeSeoCopy.description}</p>
        <p>{homeSeoCopy.body}</p>
      </section>
      <Suspense fallback={null}>
        <SchedulerDiagnostics aggregate={stream.aggregate} />
      </Suspense>
      {/*
        `stream.slotPromises` is now `Record<string, Promise<FragmentRenderResponse>>`
        (@mvp/runtime's own generic shape — see fragmentSlots.ts). Dot access
        below still type-checks (this repo's tsconfig does not set
        `noPropertyAccessFromIndexSignature`) and is what biome's
        `useLiteralKeys` lint rule expects, so it is kept — the generic type
        already removes the hand-maintained per-slot TypeScript interface;
        switching to bracket notation here would be cosmetic, not functional.
        WHICH slots get their own <Suspense> boundary and what fallback
        markup they show remains genuine human judgment (A1's explicit
        carve-out), not something codegen can decide: mounting a new slot
        never requires touching fragmentSlots.ts, but wiring it into this
        JSX (a new <Suspense><FragmentSlotStream/></Suspense> block) is the
        one deliberate hand-edit A1 carves out.
      */}
      <Suspense fallback={STATIC_EDITORIAL_FALLBACK}>
        <FragmentSlotStream
          slotPromise={stream.slotPromises.staticEditorial}
          fallback={STATIC_EDITORIAL_FALLBACK}
        />
      </Suspense>
      <Suspense fallback={PROMOTION_FALLBACK}>
        <FragmentSlotStream
          slotPromise={stream.slotPromises.promotion}
          fallback={PROMOTION_FALLBACK}
        />
      </Suspense>
      <RealtimeInsights initialSnapshot={initialSnapshot} />
      <section>
        <h2>No-JS readable collection</h2>
        <p>
          Browse durable bags, desk gear, audio essentials, and daily carry
          products without requiring client JavaScript.
        </p>
      </section>
      <Suspense fallback={RECOMMENDATIONS_FALLBACK}>
        <FragmentSlotStream
          slotPromise={stream.slotPromises.recommendations}
          fallback={RECOMMENDATIONS_FALLBACK}
        />
      </Suspense>
    </main>
  );
}
