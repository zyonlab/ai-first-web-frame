import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import { getProduct } from "../../../src/catalog";
import { fetchProductFragmentSlots } from "../../../src/fragmentSlots";
import { createProductJsonLd } from "../../../src/render";

export const dynamic = "force-dynamic";

function FragmentHtml({ html }: { html: string }) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: fragment HTML is returned by trusted internal SSR fragment services.
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const product = getProduct(id);
  return {
    title: `${product.title} | MVP Storefront`,
    description: product.description,
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = getProduct(id);
  const jsonLd = JSON.stringify(createProductJsonLd(id));
  const requestHeaders = await headers();
  const fragmentHtml = await fetchProductFragmentSlots({
    headers: requestHeaders,
    productId: id,
  });

  // The signed recently-viewed cookie is written in middleware (App Router
  // forbids cookie mutation during a Server Component render); here we only
  // read and display the computed list.

  return (
    <main data-page="product" data-product-id={product.id}>
      <article>
        <h1>{product.title}</h1>
        <p>{product.price}</p>
        <Image
          src={`/products/${product.id}.jpg`}
          alt={product.imageAlt}
          width={640}
          height={480}
          priority
        />
        <p>{product.description}</p>
        <script type="application/ld+json">{jsonLd}</script>
      </article>
      <aside data-fragment="price-panel" data-reserved="true">
        {product.price}
      </aside>
      <section data-render-strategies="product">
        <h2>Render strategy samples</h2>
        <ul>
          <li>static: {fragmentHtml.diagnostics.staticProof.source}</li>
          <li>isr: {fragmentHtml.diagnostics.promotion.source}</li>
          <li>
            dynamic-ssr: {fragmentHtml.diagnostics.recommendations.source}
          </li>
          <li>
            data dedupe: {fragmentHtml.dataDiagnostics.productSummary.firstRead}{" "}
            / {fragmentHtml.dataDiagnostics.productSummary.secondRead}
          </li>
        </ul>
      </section>
      <section data-recently-viewed="product">
        <h2>Recently viewed</h2>
        <p>
          signed cookie:{" "}
          {fragmentHtml.recentlyViewed.verified ? "verified" : "new visitor"}
        </p>
        <ul>
          {fragmentHtml.recentlyViewed.entries.map((entry) => (
            <li key={entry.id} data-recent-id={entry.id}>
              {entry.title} — {entry.price}
            </li>
          ))}
        </ul>
      </section>
      <section data-background-jobs="product">
        <h2>Background jobs</h2>
        <ul>
          <li>task: {fragmentHtml.backgroundJobs.taskId}</li>
          <li>status: {fragmentHtml.backgroundJobs.status}</li>
          <li>
            completed:{" "}
            {fragmentHtml.backgroundJobs.stats.running === 0
              ? "settled"
              : "running"}
          </li>
          <li>queued: {fragmentHtml.backgroundJobs.stats.queued}</li>
          <li>running: {fragmentHtml.backgroundJobs.stats.running}</li>
          <li>dead-letters: {fragmentHtml.backgroundJobs.stats.deadLetters}</li>
        </ul>
      </section>
      <section data-dag="product">
        <h2>DAG data dependencies</h2>
        <p>health: {fragmentHtml.dag.health}</p>
        <ul>
          {Object.entries(fragmentHtml.dag.resolveCounts).map(
            ([node, count]) => (
              <li key={node} data-dag-node={node}>
                {node}: resolved {count}x (
                {fragmentHtml.dag.data[node] ?? "n/a"})
              </li>
            ),
          )}
        </ul>
        {fragmentHtml.dag.hints.length > 0 ? (
          <ul data-dag-hints="product">
            {fragmentHtml.dag.hints.map((hint) => (
              <li key={hint.kind}>{hint.message}</li>
            ))}
          </ul>
        ) : (
          <p data-dag-hints="none">No scheduler hints.</p>
        )}
      </section>
      <section data-request-trace="product">
        <h2>Request trace</h2>
        <pre>{fragmentHtml.traceLog}</pre>
      </section>
      {fragmentHtml.staticProof ? (
        <FragmentHtml html={fragmentHtml.staticProof} />
      ) : (
        <section data-fragment="static-product-proof" data-fallback="true">
          Static product proof is unavailable.
        </section>
      )}
      {fragmentHtml.promotion ? (
        <FragmentHtml html={fragmentHtml.promotion} />
      ) : (
        <section data-fragment="promotion-banner" data-fallback="true">
          Product promotion is loading.
        </section>
      )}
      {fragmentHtml.recommendations ? (
        <FragmentHtml html={fragmentHtml.recommendations} />
      ) : (
        <section data-fragment="recommendation-widget" data-fallback="true">
          Related products are loading.
        </section>
      )}
    </main>
  );
}
