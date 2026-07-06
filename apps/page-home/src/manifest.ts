import { homePageBudget } from "./budget";

export const homePageManifest = {
  name: "page-home",
  route: "/",
  owner: "web-platform",
  version: "0.1.0",
  renderMode: "hybrid",
  renderStrategy: "hybrid",
  seo: {
    title: "MVP Storefront Home",
    description:
      "Discover curated offers and personalized recommendations in the MVP storefront.",
  },
  slots: [
    {
      name: "staticEditorial",
      fragment: "static-editorial-note",
      channel: "stable",
      strategy: "static",
      required: false,
    },
    {
      name: "promotion",
      fragment: "promotion-banner",
      channel: "stable",
      strategy: "cached-ssr",
      timeoutMs: 200,
      required: false,
    },
    {
      name: "recommendations",
      fragment: "recommendation-widget",
      channel: "stable",
      strategy: "dynamic-ssr",
      timeoutMs: 200,
      required: false,
    },
  ],
  budget: homePageBudget,
} as const;

export function validateHomePageManifest(manifest = homePageManifest): boolean {
  return Boolean(
    manifest.route &&
      manifest.renderMode &&
      manifest.seo &&
      manifest.budget &&
      manifest.slots.length > 0,
  );
}
