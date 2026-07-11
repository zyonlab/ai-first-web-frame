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
  // Verified against src/manifest.slots.json + src/fragmentSlots.ts:
  //  - ttl-cache-freshness — the "promotion" slot uses the "isr" strategy
  //    (deprecated alias of "ttl-cache", normalizeRenderStrategy() in
  //    packages/runtime; @mvp/runtime caches its response by cachePolicy.ttl
  //    = 300s). Literal spelling is scheduled to change to "ttl-cache" by
  //    the isr-literal-codemod task; the capability itself is real today.
  //  - reserved-slots — the "price-panel" slot is marked `reserved: true`,
  //    excluded from fragmentSlots.gen.ts by packages/registry/src/codegen.ts,
  //    and hand-rendered as a static aside in app/product/[id]/page.tsx.
  demonstrates: ["ttl-cache-freshness", "reserved-slots"],
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
