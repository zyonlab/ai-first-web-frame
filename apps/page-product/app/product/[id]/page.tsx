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
  const fragmentHtml = await fetchProductFragmentSlots({
    headers: await headers(),
  });

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
