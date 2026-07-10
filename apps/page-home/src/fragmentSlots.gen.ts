/**
 * GENERATED FILE — do not edit by hand.
 * Source of truth: apps/page-home/src/manifest.slots.json
 * Regenerate after any manifest edit:
 *   pnpm exec tsx scripts/mount-slot.mts --page page-home --slot <name> --fragment <fragment> [...flags]
 * Freshness check (wired into `pnpm verify:manifest-gen`):
 *   pnpm exec tsx scripts/mount-slot.mts --page page-home --check
 */

import type { FragmentSlotDefinition } from "@mvp/runtime";

export const fragmentSlots: FragmentSlotDefinition[] = [
  {
    name: "staticEditorial",
    fragment: "static-editorial-note",
    channel: "stable",
    strategy: "static",
    staticHtml:
      '<section data-fragment="static-editorial-note" data-render-strategy="static"><h2>Static SSG sample</h2><p>This editorial block is emitted without a runtime fragment service call.</p></section>',
    required: false,
  },
  {
    name: "promotion",
    fragment: "promotion-banner",
    channel: "stable",
    strategy: "cached-ssr",
    timeoutMs: 200,
    props: {
      scene: "home",
      campaignId: "summer",
    },
    cachePolicy: {
      ttl: 60,
      tags: ["promotion", "home"],
      vary: ["tenant", "locale", "experiment", "props"],
    },
    dataDependencies: ["home-featured-content"],
    required: true,
  },
  {
    name: "recommendations",
    fragment: "recommendation-widget",
    channel: "stable",
    strategy: "dynamic-ssr",
    timeoutMs: 200,
    props: {
      scene: "home",
      limit: 3,
    },
    required: false,
  },
];
