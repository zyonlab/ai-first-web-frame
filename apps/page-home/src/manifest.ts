import { homePageBudget } from "./budget";
import homePageSlots from "./manifest.slots.json";

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
  slots: homePageSlots,
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
