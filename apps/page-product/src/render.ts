import { getProduct } from "./catalog";

export type ProductFragments = {
  staticProof?: string | null;
  promotion?: string | null;
  recommendations?: string | null;
  pricePanel?: string | null;
};

export function createProductJsonLd(id: string) {
  const product = getProduct(id);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description,
    image: `https://example.com/products/${product.id}.jpg`,
    offers: {
      "@type": "Offer",
      price: product.price.replace("$", ""),
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  };
}

export function renderProductHtml(
  id: string,
  fragments: ProductFragments = {},
) {
  const product = getProduct(id);
  const recommendations =
    fragments.recommendations ??
    `<section data-fragment="recommendation-widget" data-fallback="true">Related products are loading.</section>`;
  const staticProof =
    fragments.staticProof ??
    `<section data-fragment="static-product-proof" data-render-strategy="static">Static product proof</section>`;
  const promotion =
    fragments.promotion ??
    `<section data-fragment="promotion-banner" data-fallback="true">Product promotion is loading.</section>`;
  const pricePanel =
    fragments.pricePanel ??
    `<aside data-fragment="price-panel" data-reserved="true">${product.price}</aside>`;
  const jsonLd = JSON.stringify(createProductJsonLd(id));

  return `<main data-page="product" data-product-id="${escapeHtml(product.id)}">
    <article>
      <h1>${escapeHtml(product.title)}</h1>
      <p>${escapeHtml(product.price)}</p>
      <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.imageAlt)}" width="640" height="480" />
      <p>${escapeHtml(product.description)}</p>
      <script type="application/ld+json">${jsonLd}</script>
    </article>
    ${pricePanel}
    ${staticProof}
    ${promotion}
    ${recommendations}
  </main>`;
}

export const usedUiComponents = [
  "ProductCardBase",
  "Section",
  "Skeleton",
] as const;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
