export const promotionBannerBudget = {
  scope: "fragment",
  name: "promotion-banner",
  jsBytes: 30000,
  cssBytes: 10000,
  maxFragmentLatencyMs: 200,
  maxRenderMs: 50,
  maxMemoryMB: 20,
} as const;
