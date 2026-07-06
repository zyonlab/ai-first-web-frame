import { headers } from "next/headers";
import type { ReactNode } from "react";
import { fetchHomeFragmentSlots } from "../src/fragmentSlots";
import { homeSeoCopy } from "../src/render";

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

  return (
    <main data-page="home">
      <section>
        <h1>{homeSeoCopy.title}</h1>
        <p>{homeSeoCopy.description}</p>
        <p>{homeSeoCopy.body}</p>
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
