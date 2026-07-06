import type { RequestContext } from "@mvp/contracts";
import { createDataClient, defineDataSource } from "@mvp/data";
import type { RequestTrace } from "@mvp/observability";

export type RecommendationProduct = {
  id: string;
  title: string;
  price: string;
};

/**
 * Product catalog stood in for a personalization/recommendations service. It is
 * read through the framework data client (never a bare fetch). Recommendations
 * are per-request personalized, so the dependency uses request-time freshness
 * with no TTL cache (dynamic-ssr) — each render loads fresh.
 */
const catalog: RecommendationProduct[] = [
  { id: "sku-1", title: "Everyday Travel Pack", price: "$79" },
  { id: "sku-2", title: "Modular Desk Lamp", price: "$48" },
  { id: "sku-3", title: "Noise Soft Earbuds", price: "$129" },
  { id: "sku-4", title: "Trail Bottle", price: "$24" },
];

export const recommendationSource = defineDataSource<RecommendationProduct[]>({
  id: "recommendations",
  dependency: {
    id: "recommendations",
    owner: "fragment",
    source: "api",
    freshness: "request-time",
    privacy: "public",
    invalidationTags: ["recommendation"],
    dependsOn: [],
  },
  load({ params }) {
    const limit = Number(params.limit ?? catalog.length);
    return catalog.slice(0, limit);
  },
});

export function createRecommendationDataClient(
  ctx: RequestContext,
  trace?: RequestTrace,
) {
  // No shared cache: request-time freshness re-loads on every render.
  return createDataClient({
    ctx,
    sources: [recommendationSource],
    trace,
  });
}

export async function loadRecommendations(
  ctx: RequestContext,
  params: { limit: number; scene: string },
  trace?: RequestTrace,
): Promise<RecommendationProduct[]> {
  const client = createRecommendationDataClient(ctx, trace);
  const result = await client.readData<RecommendationProduct[]>(
    "recommendations",
    params,
  );
  return result.data;
}

export const recommendationCatalogSize = catalog.length;
