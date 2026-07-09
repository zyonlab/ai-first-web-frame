import type { RequestContext } from "@mvp/contracts";
import type { RequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import { loadRecommendations, recommendationCatalogSize } from "./data";
import { recommendationWidgetManifest } from "./manifest";

export type RecommendationRenderRequest = {
  ctx?: {
    locale?: string;
    tenant?: string;
    traceId?: string;
  };
  props?: {
    scene?: "home" | "product" | string;
    limit?: number;
  };
};

export type RecommendationRenderOptions = {
  /** Active request trace; a render span is recorded when provided. */
  trace?: RequestTrace;
};

function toRequestContext(
  ctx: RecommendationRenderRequest["ctx"],
): RequestContext {
  return createRequestContext({
    headers: {
      "x-locale": ctx?.locale ?? "en-US",
      "x-tenant": ctx?.tenant ?? "default",
      ...(ctx?.traceId ? { "x-trace-id": ctx.traceId } : {}),
    },
  });
}

export async function renderRecommendationWidget(
  request: RecommendationRenderRequest,
  options: RecommendationRenderOptions = {},
) {
  const { trace } = options;
  const renderSpan = trace?.startSpan(
    "render:recommendation-widget",
    "fragment",
    { attributes: { fragment: recommendationWidgetManifest.name } },
  );

  try {
    const ctx = toRequestContext(request.ctx);
    const limit = Math.max(
      1,
      Math.min(request.props?.limit ?? 3, recommendationCatalogSize),
    );
    const scene = request.props?.scene ?? "home";

    const products = await loadRecommendations(ctx, { limit, scene }, trace);
    const cards = products
      .map(
        (product) =>
          `<article data-product-id="${product.id}"><h3>${escapeHtml(product.title)}</h3><p>${product.price}</p></article>`,
      )
      .join("");

    trace?.endSpan(renderSpan ?? "", {
      status: "ok",
      attributes: { scene, limit, count: products.length, propsValid: true },
    });

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
    trace?.endSpan(renderSpan ?? "", {
      status: "error",
      attributes: {
        error: error instanceof Error ? error.message : "render failed",
      },
    });
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
      // Contract flag: marks this response as a degraded fallback.
      fallback: true,
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
