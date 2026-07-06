import { recommendationWidgetBudget } from "./budget";

export const recommendationWidgetManifest = {
  name: "recommendation-widget",
  owner: "personalization",
  version: "0.1.0",
  renderMode: "ssr",
  renderStrategy: "dynamic-ssr",
  cachePolicy: {
    ttl: 0,
    tags: ["recommendation"],
    vary: ["tenant", "locale", "experiment", "props"],
  },
  endpoint: "/render",
  fallback:
    '<section data-fragment="recommendation-widget">Recommendations temporarily unavailable</section>',
  assets: {
    js: [],
    css: ["/assets/recommendation-widget.css"],
  },
  budget: recommendationWidgetBudget,
  metadata: {
    category: "recommendation",
    description: "SSR personalized product recommendation cards",
  },
} as const;

export function validateRecommendationWidgetManifest(
  manifest = recommendationWidgetManifest,
): boolean {
  return Boolean(
    manifest.name &&
      manifest.owner &&
      manifest.version &&
      manifest.renderMode &&
      manifest.fallback &&
      manifest.assets &&
      manifest.budget,
  );
}
