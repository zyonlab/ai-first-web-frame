import { productPageBudget } from "./budget";
import productPageSlots from "./manifest.slots.json";

export const productPageManifest = {
  name: "page-product",
  route: "/product/:id",
  owner: "commerce",
  version: "0.1.0",
  renderMode: "hybrid",
  renderStrategy: "hybrid",
  revalidateSeconds: 300,
  seo: {
    title: "Product details",
    description: "Server-rendered product detail page with structured data.",
  },
  slots: productPageSlots,
  budget: productPageBudget,
} as const;

export function validateProductPageManifest(
  manifest = productPageManifest,
): boolean {
  return Boolean(
    manifest.route &&
      manifest.renderMode &&
      manifest.seo &&
      manifest.budget &&
      manifest.slots.length > 0,
  );
}
