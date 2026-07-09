import type { RequestContext } from "@mvp/contracts";
import type { RequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import { loadPromotionContent } from "./data";
import { promotionBannerManifest } from "./manifest";

export type PromotionBannerRenderRequest = {
  ctx?: {
    locale?: string;
    tenant?: string;
    traceId?: string;
  };
  props?: {
    scene?: "home" | "product" | string;
    campaignId?: string;
  };
};

export type PromotionBannerRenderOptions = {
  /** Active request trace; a render span is recorded when provided. */
  trace?: RequestTrace;
};

function toRequestContext(
  ctx: PromotionBannerRenderRequest["ctx"],
): RequestContext {
  return createRequestContext({
    headers: {
      "x-locale": ctx?.locale ?? "en-US",
      "x-tenant": ctx?.tenant ?? "default",
      ...(ctx?.traceId ? { "x-trace-id": ctx.traceId } : {}),
    },
  });
}

export async function renderPromotionBanner(
  request: PromotionBannerRenderRequest,
  options: PromotionBannerRenderOptions = {},
) {
  const { trace } = options;
  const renderSpan = trace?.startSpan("render:promotion-banner", "fragment", {
    attributes: { fragment: promotionBannerManifest.name },
  });

  if (!request.props) {
    trace?.endSpan(renderSpan ?? "", {
      status: "fallback",
      attributes: { reason: "missing props", propsValid: false },
    });
    return {
      statusCode: 400,
      body: createPromotionFallback("missing props"),
    };
  }

  try {
    const ctx = toRequestContext(request.ctx);
    const locale = ctx.locale;
    const scene = request.props.scene ?? "home";
    const campaignId = request.props.campaignId ?? "default";
    const copy =
      locale.toLowerCase().startsWith("zh") ||
      locale.toLowerCase().startsWith("ms")
        ? "限时优惠"
        : "Limited time offer";

    const content = await loadPromotionContent(ctx, campaignId, trace);

    trace?.endSpan(renderSpan ?? "", {
      status: "ok",
      attributes: { scene, campaignId, propsValid: true },
    });

    return {
      statusCode: 200,
      body: {
        html: `<section data-fragment="promotion-banner" data-scene="${escapeHtml(scene)}"><p>${copy}</p><strong>${escapeHtml(content.campaignId)}</strong><span data-headline="${escapeHtml(content.headline)}">${escapeHtml(content.headline)} ${escapeHtml(content.discount)}</span></section>`,
        assets: promotionBannerManifest.assets,
        cache: {
          ttl: 60,
          tags: ["promotion", scene],
        },
        metadata: {
          name: promotionBannerManifest.name,
          version: promotionBannerManifest.version,
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
      body: createPromotionFallback(
        error instanceof Error ? error.message : "render failed",
      ),
    };
  }
}

export function createPromotionFallback(reason: string) {
  return {
    html: `<section data-fragment="promotion-banner" data-fallback="true">Promotion unavailable: ${escapeHtml(reason)}</section>`,
    assets: { js: [], css: [] },
    cache: { ttl: 10, tags: ["promotion", "fallback"] },
    metadata: {
      name: promotionBannerManifest.name,
      version: promotionBannerManifest.version,
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
