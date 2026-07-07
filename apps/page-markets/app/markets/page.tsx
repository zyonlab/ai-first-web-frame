import { headers } from "next/headers";
import type { ReactNode } from "react";
import {
  fetchMarketsFragmentSlots,
  type MarketsSlotKey,
} from "../../src/fragmentSlots";
import { MARKETS_LAYOUT_CLASS } from "../../src/gridStyles";
import { marketsSeoCopy } from "../../src/render";

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

/** No-JS-readable fallback for a degraded/absent table. */
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

export default async function MarketsPage() {
  const fragmentHtml = await fetchMarketsFragmentSlots({
    headers: await headers(),
  });
  const slots = fragmentHtml.slots;

  const diagnosticsList = Object.entries(fragmentHtml.diagnostics) as [
    MarketsSlotKey,
    (typeof fragmentHtml.diagnostics)[MarketsSlotKey],
  ][];

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
          <FragmentHtml
            html={slots.marketsTable}
            fallback={
              <PanelFallback fragment="markets-table">
                Markets table is loading.
              </PanelFallback>
            }
          />
        </div>
      </div>

      {/* Scheduler health + hints (mirrors page-trade / page-home diagnostics
          posture, simplified for the single-slot page). */}
      <section data-scheduler-health="markets">
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

      {/* Request trace (dependency-graph log), mirrors page-trade. */}
      <section data-request-trace="markets">
        <h2>Request trace</h2>
        <pre>{fragmentHtml.traceLog}</pre>
      </section>
    </main>
  );
}
