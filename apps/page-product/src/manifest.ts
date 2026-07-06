import { productPageBudget } from "./budget";

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
  slots: [
    {
      name: "staticProof",
      fragment: "static-product-proof",
      channel: "stable",
      strategy: "static",
      required: false,
    },
    {
      name: "promotion",
      fragment: "promotion-banner",
      channel: "stable",
      strategy: "isr",
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
    {
      name: "price-panel",
      fragment: "price-panel",
      channel: "stable",
      required: false,
      reserved: true,
    },
  ],
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
