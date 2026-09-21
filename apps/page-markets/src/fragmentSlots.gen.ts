/**
 * GENERATED FILE — do not edit by hand.
 * Source of truth: apps/page-markets/src/manifest.slots.json
 * Regenerate after any manifest edit:
 *   pnpm exec tsx scripts/mount-slot.mts --page page-markets --slot <name> --fragment <fragment> [...flags]
 * Freshness check (wired into `pnpm verify:manifest-gen`):
 *   pnpm exec tsx scripts/mount-slot.mts --page page-markets --check
 */

import type { FragmentSlotDefinition } from "@mvp/runtime";

export const fragmentSlots: FragmentSlotDefinition[] = [
  {
    name: "marketsTable",
    fragment: "markets-table",
    channel: "canary",
    strategy: "cached-ssr",
    timeoutMs: 200,
    cachePolicy: {
      ttl: 5,
      tags: ["markets", "ticker"],
      vary: ["tenant", "locale", "props"],
    },
    required: true,
    reserveHeightPx: 109,
  },
];
