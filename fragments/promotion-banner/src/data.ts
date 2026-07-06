import type { RequestContext } from "@mvp/contracts";
import {
  createDataClient,
  type DataCacheEntry,
  defineDataSource,
} from "@mvp/data";
import type { RequestTrace } from "@mvp/observability";

export type PromotionContent = {
  campaignId: string;
  headline: string;
  discount: string;
};

/**
 * Static campaign catalog stood in for a CMS/promotions API. It is read through
 * the framework data client (never a bare fetch) so the fragment exercises the
 * data plane: request-time freshness with a short TTL cache and tag-based
 * invalidation.
 */
const campaigns: Record<string, PromotionContent> = {
  summer: {
    campaignId: "summer",
    headline: "Summer Sale",
    discount: "-30%",
  },
  default: {
    campaignId: "default",
    headline: "Featured Offer",
    discount: "-10%",
  },
};

export const promotionContentSource = defineDataSource<PromotionContent>({
  id: "promotion-content",
  dependency: {
    id: "promotion-content",
    owner: "fragment",
    source: "api",
    freshness: "request-time",
    privacy: "public",
    cachePolicy: { ttl: 60, tags: ["promotion"], vary: ["locale", "props"] },
    invalidationTags: ["promotion"],
    dependsOn: [],
  },
  load({ params }) {
    const campaignId = String(params.campaignId ?? "default");
    return campaigns[campaignId] ?? campaigns.default;
  },
});

/**
 * Creates a data client bound to the request context. A shared cache map is
 * kept process-wide so the TTL cache survives across requests, mirroring a
 * long-lived server cache.
 */
const sharedCache = new Map<string, DataCacheEntry>();

export function createPromotionDataClient(
  ctx: RequestContext,
  trace?: RequestTrace,
) {
  return createDataClient({
    ctx,
    sources: [promotionContentSource],
    cache: sharedCache,
    trace,
  });
}

export async function loadPromotionContent(
  ctx: RequestContext,
  campaignId: string,
  trace?: RequestTrace,
): Promise<PromotionContent> {
  const client = createPromotionDataClient(ctx, trace);
  const result = await client.readData<PromotionContent>("promotion-content", {
    campaignId,
  });
  return result.data;
}
