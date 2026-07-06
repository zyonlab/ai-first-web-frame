import { headers } from "next/headers";
import type { ReactNode } from "react";
import { fetchHomeFragmentSlots } from "../src/fragmentSlots";
import { computeRealtimeSnapshot } from "../src/realtimeInsights";
import { homeSeoCopy } from "../src/render";
import { RealtimeInsights } from "./RealtimeInsights";

export const dynamic = "force-dynamic";

function FragmentHtml({
  html,
  fallback,
}: {
  html: string | null;
  fallback: ReactNode;
}) {
  if (!html) return fallback;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: fragment HTML is returned by trusted internal SSR fragment services.
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export default async function HomePage() {
  const fragmentHtml = await fetchHomeFragmentSlots({
    headers: await headers(),
  });
  // Deterministic SSR first paint for the realtime island: readable with no JS.
  const initialSnapshot = computeRealtimeSnapshot("all", 0);

  return (
    <main data-page="home">
      <section>
        <h1>{homeSeoCopy.title}</h1>
        <p>{homeSeoCopy.description}</p>
        <p>{homeSeoCopy.body}</p>
      </section>
      <section data-scheduler-health="home">
        <h2>Scheduler health &amp; hints</h2>
        <p>
          Page health:{" "}
          <span data-field="health">{fragmentHtml.scheduler.health}</span>
        </p>
        <ul data-field="slot-status">
          {Object.entries(fragmentHtml.diagnostics).map(([name, diag]) => (
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
      <section data-render-strategies="home">
        <h2>Render strategy samples</h2>
        <ul>
          <li>static: {fragmentHtml.diagnostics.staticEditorial.source}</li>
          <li>cached-ssr: {fragmentHtml.diagnostics.promotion.source}</li>
          <li>
            dynamic-ssr: {fragmentHtml.diagnostics.recommendations.source}
          </li>
          <li>
            data dedupe:{" "}
            {fragmentHtml.dataDiagnostics.featuredContent.firstRead} /{" "}
            {fragmentHtml.dataDiagnostics.featuredContent.secondRead}
          </li>
        </ul>
      </section>
      <section data-request-trace="home">
        <h2>Request trace</h2>
        <pre>{fragmentHtml.traceLog}</pre>
      </section>
      <FragmentHtml
        html={fragmentHtml.staticEditorial}
        fallback={
          <section data-fragment="static-editorial-note" data-fallback="true">
            Static editorial is unavailable.
          </section>
        }
      />
      <FragmentHtml
        html={fragmentHtml.promotion}
        fallback={
          <section data-fragment="promotion-banner" data-fallback="true">
            Featured offers are loading.
          </section>
        }
      />
      <RealtimeInsights initialSnapshot={initialSnapshot} />
      <section>
        <h2>No-JS readable collection</h2>
        <p>
          Browse durable bags, desk gear, audio essentials, and daily carry
          products without requiring client JavaScript.
        </p>
      </section>
      <FragmentHtml
        html={fragmentHtml.recommendations}
        fallback={
          <section data-fragment="recommendation-widget" data-fallback="true">
            Recommendations are loading.
          </section>
        }
      />
    </main>
  );
}
