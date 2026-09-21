import { FragmentSlotStream } from "@mvp/runtime/react";
import { createPageMetadata, isDiagnosticsEnabled } from "@mvp/runtime/seo";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import { Suspense } from "react";
import { getProduct } from "../../../src/catalog";
import {
  type ProductFragmentAggregate,
  streamProductFragmentSlots,
} from "../../../src/fragmentSlots";
import { createProductJsonLd } from "../../../src/render";

export const dynamic = "force-dynamic";

// Fallback markup, defined once per slot and reused for both the Suspense
// loading placeholder and `<FragmentSlotStream>`'s own "resolved but empty"
// fallback — the same single fallback contract every existing test/e2e spec
// already anchors on (refactor plan §4.4: fallback semantics unchanged).
const STATIC_PROOF_FALLBACK = (
  <section data-fragment="static-product-proof" data-fallback="true">
    Static product proof is unavailable.
  </section>
);
const PROMOTION_FALLBACK = (
  <section data-fragment="promotion-banner" data-fallback="true">
    Product promotion is loading.
  </section>
);
const RECOMMENDATIONS_FALLBACK = (
  <section data-fragment="recommendation-widget" data-fallback="true">
    Related products are loading.
  </section>
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const product = getProduct(id);
  // Per-product canonical against the PUBLIC origin: this document is reachable
  // both through the shell (:4100) and directly on the page app (:4102), so the
  // canonical is what collapses them into one indexable URL.
  return createPageMetadata({
    title: `${product.title} | MVP Storefront`,
    description: product.description,
    path: `/product/${id}`,
    type: "article",
  });
}

/**
 * Render-strategy samples / recently-viewed / background-jobs / DAG /
 * request-trace sections (refactor plan §4.4). This inherently needs the
 * FULL aggregate result — every slot's status, the data-dependency DAG, the
 * recently-viewed cookie lookup, and the background job — so it can only
 * resolve once the slowest of that work settles, same as before this
 * refactor. It gets its own async Server Component + `<Suspense>` boundary
 * purely so it never blocks the static shell or the three fragment slots
 * from streaming ahead of it; it still always settles last, which is
 * correct, not a regression.
 */
async function ProductDiagnostics({
  aggregate,
}: {
  aggregate: Promise<ProductFragmentAggregate>;
}) {
  const diag = await aggregate;
  return (
    <>
      <section data-render-strategies="product">
        <h2>Render strategy samples</h2>
        <ul>
          <li>static: {diag.diagnostics.staticProof.source}</li>
          <li>isr: {diag.diagnostics.promotion.source}</li>
          <li>dynamic-ssr: {diag.diagnostics.recommendations.source}</li>
          <li>
            data dedupe: {diag.dataDiagnostics.productSummary.firstRead} /{" "}
            {diag.dataDiagnostics.productSummary.secondRead}
          </li>
        </ul>
      </section>
      <section data-recently-viewed="product">
        <h2>Recently viewed</h2>
        <p>
          signed cookie:{" "}
          {diag.recentlyViewed.verified ? "verified" : "new visitor"}
        </p>
        <ul>
          {diag.recentlyViewed.entries.map((entry) => (
            <li key={entry.id} data-recent-id={entry.id}>
              {entry.title} — {entry.price}
            </li>
          ))}
        </ul>
      </section>
      <section data-background-jobs="product">
        <h2>Background jobs</h2>
        <ul>
          <li>task: {diag.backgroundJobs.taskId}</li>
          <li>status: {diag.backgroundJobs.status}</li>
          <li>
            completed:{" "}
            {diag.backgroundJobs.stats.running === 0 ? "settled" : "running"}
          </li>
          <li>queued: {diag.backgroundJobs.stats.queued}</li>
          <li>running: {diag.backgroundJobs.stats.running}</li>
          <li>dead-letters: {diag.backgroundJobs.stats.deadLetters}</li>
        </ul>
      </section>
      <section data-dag="product">
        <h2>DAG data dependencies</h2>
        <p>health: {diag.dag.health}</p>
        <ul>
          {Object.entries(diag.dag.resolveCounts).map(([node, count]) => (
            <li key={node} data-dag-node={node}>
              {node}: resolved {count}x ({diag.dag.data[node] ?? "n/a"})
            </li>
          ))}
        </ul>
        {diag.dag.hints.length > 0 ? (
          <ul data-dag-hints="product">
            {diag.dag.hints.map((hint) => (
              // Composite key like the other four pages: two hints can share
              // a `kind` (one per slot group), and keying on `kind` alone made
              // React warn about duplicate children on every product render.
              <li key={`${hint.kind}:${hint.slots.join(",")}`}>
                {hint.message}
              </li>
            ))}
          </ul>
        ) : (
          <p data-dag-hints="none">No scheduler hints.</p>
        )}
      </section>
      <section data-request-trace="product">
        <h2>Request trace</h2>
        <pre>{diag.traceLog}</pre>
      </section>
    </>
  );
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
  // No further await before this point: the static shell below (title,
  // price, image, description, JSON-LD) needs nothing async and is the very
  // first thing flushed. `streamProductFragmentSlots` itself is synchronous
  // — it returns a handle of promises immediately, it does not block
  // (refactor plan §4.4).
  const stream = streamProductFragmentSlots({
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
          src={product.image}
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
          <ProductDiagnostics aggregate={stream.aggregate} />
        </Suspense>
      )}
      <Suspense fallback={STATIC_PROOF_FALLBACK}>
        <FragmentSlotStream
          slotPromise={stream.slotPromises.staticProof}
          fallback={STATIC_PROOF_FALLBACK}
        />
      </Suspense>
      <Suspense fallback={PROMOTION_FALLBACK}>
        <FragmentSlotStream
          slotPromise={stream.slotPromises.promotion}
          fallback={PROMOTION_FALLBACK}
        />
      </Suspense>
      <Suspense fallback={RECOMMENDATIONS_FALLBACK}>
        <FragmentSlotStream
          slotPromise={stream.slotPromises.recommendations}
          fallback={RECOMMENDATIONS_FALLBACK}
        />
      </Suspense>
    </main>
  );
}
