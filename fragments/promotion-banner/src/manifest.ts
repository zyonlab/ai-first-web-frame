import { promotionBannerBudget } from "./budget";

export const promotionBannerManifest = {
  name: "promotion-banner",
  owner: "growth",
  version: "0.1.0",
  renderMode: "ssr",
  renderStrategy: "cached-ssr",
  cachePolicy: {
    ttl: 60,
    tags: ["promotion"],
    vary: ["tenant", "locale", "experiment", "props"],
  },
  endpoint: "/render",
  fallback:
    '<section data-fragment="promotion-banner">Promotion temporarily unavailable</section>',
  assets: {
    js: [],
    css: ["/assets/promotion-banner.css"],
  },
  budget: promotionBannerBudget,
  metadata: {
    category: "promotion",
    description: "SSR campaign banner for home and product merchandising slots",
  },
} as const;

export function validatePromotionBannerManifest(
  manifest = promotionBannerManifest,
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
