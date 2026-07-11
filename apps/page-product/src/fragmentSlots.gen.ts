/**
 * GENERATED FILE — do not edit by hand.
 * Source of truth: apps/page-product/src/manifest.slots.json
 * Regenerate after any manifest edit:
 *   pnpm exec tsx scripts/mount-slot.mts --page page-product --slot <name> --fragment <fragment> [...flags]
 * Freshness check (wired into `pnpm verify:manifest-gen`):
 *   pnpm exec tsx scripts/mount-slot.mts --page page-product --check
 */

import type { FragmentSlotDefinition } from "@mvp/runtime";

export const fragmentSlots: FragmentSlotDefinition[] = [
  {
    name: "staticProof",
    fragment: "static-product-proof",
    channel: "stable",
    strategy: "static",
    staticHtml:
      '<section data-fragment="static-product-proof" data-render-strategy="static"><h2>Static product proof</h2><p>This proof block is safe to prerender as static HTML.</p></section>',
    required: false,
  },
  {
    name: "promotion",
    fragment: "promotion-banner",
    channel: "stable",
    strategy: "ttl-cache",
    timeoutMs: 200,
    props: {
      scene: "product",
      campaignId: "product-launch",
    },
    cachePolicy: {
      ttl: 300,
      tags: ["promotion", "product"],
      vary: ["tenant", "locale", "experiment", "props"],
    },
    dataDependencies: ["product-promotion"],
    required: false,
  },
  {
    name: "recommendations",
    fragment: "recommendation-widget",
    channel: "stable",
    strategy: "dynamic-ssr",
    timeoutMs: 200,
    props: {
      scene: "product",
      limit: 3,
    },
    dataDependencies: ["product-price"],
    required: false,
  },
];
