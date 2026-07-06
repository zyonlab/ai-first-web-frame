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

export function renderPromotionBanner(request: PromotionBannerRenderRequest) {
  if (!request.props) {
    return {
      statusCode: 400,
      body: createPromotionFallback("missing props"),
    };
  }

  try {
    const locale = request.ctx?.locale ?? "en-US";
    const scene = request.props.scene ?? "home";
    const campaignId = request.props.campaignId ?? "default";
    const copy =
      locale.toLowerCase().startsWith("zh") ||
      locale.toLowerCase().startsWith("ms")
        ? "限时优惠"
        : "Limited time offer";

    return {
      statusCode: 200,
      body: {
        html: `<section data-fragment="promotion-banner" data-scene="${escapeHtml(scene)}"><p>${copy}</p><strong>${escapeHtml(campaignId)}</strong></section>`,
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
