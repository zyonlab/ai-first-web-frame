/**
 * GENERATED FILE — do not edit by hand.
 * Source of truth: apps/page-portfolio/src/manifest.slots.json
 * Regenerate after any manifest edit:
 *   pnpm exec tsx scripts/mount-slot.mts --page page-portfolio --slot <name> --fragment <fragment> [...flags]
 * Freshness check (wired into `pnpm verify:manifest-gen`):
 *   pnpm exec tsx scripts/mount-slot.mts --page page-portfolio --check
 */

import type { FragmentSlotDefinition } from "@mvp/runtime";

export const fragmentSlots: FragmentSlotDefinition[] = [
  {
    name: "portfolioSummary",
    fragment: "portfolio-summary",
    channel: "canary",
    strategy: "dynamic-ssr",
    timeoutMs: 200,
    cachePolicy: {
      ttl: 0,
      tags: ["portfolio", "account"],
      vary: ["tenant", "props"],
    },
    required: true,
    reserveHeightPx: 164,
  },
  {
    name: "pnlChart",
    fragment: "pnl-chart",
    channel: "canary",
    strategy: "ttl-cache",
    timeoutMs: 200,
    cachePolicy: {
      ttl: 60,
      tags: ["portfolio", "pnl"],
      vary: ["tenant", "locale", "props"],
    },
    required: false,
    reserveHeightPx: 463,
  },
];
