import { recommendationWidgetManifest } from "./manifest";

export type RecommendationRenderRequest = {
  ctx?: {
    locale?: string;
    traceId?: string;
  };
  props?: {
    scene?: "home" | "product" | string;
    limit?: number;
  };
};

const products = [
  { id: "sku-1", title: "Everyday Travel Pack", price: "$79" },
  { id: "sku-2", title: "Modular Desk Lamp", price: "$48" },
  { id: "sku-3", title: "Noise Soft Earbuds", price: "$129" },
  { id: "sku-4", title: "Trail Bottle", price: "$24" },
];

export function renderRecommendationWidget(
  request: RecommendationRenderRequest,
) {
  try {
    const limit = Math.max(
      1,
      Math.min(request.props?.limit ?? 3, products.length),
    );
    const scene = request.props?.scene ?? "home";
    const cards = products
      .slice(0, limit)
      .map(
        (product) =>
          `<article data-product-id="${product.id}"><h3>${escapeHtml(product.title)}</h3><p>${product.price}</p></article>`,
      )
      .join("");

    return {
      statusCode: 200,
      body: {
        html: `<section data-fragment="recommendation-widget" data-scene="${escapeHtml(scene)}"><h2>Recommended for you</h2>${cards}</section>`,
        assets: recommendationWidgetManifest.assets,
        cache: {
          ttl: 120,
          tags: ["recommendation", scene],
        },
        metadata: {
          name: recommendationWidgetManifest.name,
          version: recommendationWidgetManifest.version,
        },
      },
    };
  } catch (error) {
    return {
      statusCode: 200,
      body: createRecommendationFallback(
        error instanceof Error ? error.message : "render failed",
      ),
    };
  }
}

export function createRecommendationFallback(reason: string) {
  return {
    html: `<section data-fragment="recommendation-widget" data-fallback="true">Recommendations unavailable: ${escapeHtml(reason)}</section>`,
    assets: { js: [], css: [] },
    cache: { ttl: 10, tags: ["recommendation", "fallback"] },
    metadata: {
      name: recommendationWidgetManifest.name,
      version: recommendationWidgetManifest.version,
    },
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
