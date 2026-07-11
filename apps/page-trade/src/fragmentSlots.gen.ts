/**
 * GENERATED FILE — do not edit by hand.
 * Source of truth: apps/page-trade/src/manifest.slots.json
 * Regenerate after any manifest edit:
 *   pnpm exec tsx scripts/mount-slot.mts --page page-trade --slot <name> --fragment <fragment> [...flags]
 * Freshness check (wired into `pnpm verify:manifest-gen`):
 *   pnpm exec tsx scripts/mount-slot.mts --page page-trade --check
 */

import type { FragmentSlotDefinition } from "@mvp/runtime";

export const fragmentSlots: FragmentSlotDefinition[] = [
  {
    name: "marketHeader",
    fragment: "market-header",
    channel: "canary",
    strategy: "cached-ssr",
    timeoutMs: 200,
    cachePolicy: {
      ttl: 5,
      tags: ["ticker", "trade"],
      vary: ["tenant", "locale", "props"],
    },
    required: true,
  },
  {
    name: "book",
    fragment: "order-book",
    channel: "canary",
    strategy: "dynamic-ssr",
    timeoutMs: 200,
    required: false,
  },
  {
    name: "trades",
    fragment: "trades-feed",
    channel: "canary",
    strategy: "dynamic-ssr",
    timeoutMs: 200,
    required: false,
  },
  {
    name: "orderForm",
    fragment: "order-form",
    channel: "canary",
    strategy: "dynamic-ssr",
    timeoutMs: 200,
    dataDependencies: ["trade-account"],
    required: false,
  },
  {
    name: "positions",
    fragment: "positions-table",
    channel: "canary",
    strategy: "dynamic-ssr",
    timeoutMs: 200,
    dataDependencies: ["trade-account"],
    required: false,
  },
  {
    name: "openOrders",
    fragment: "open-orders",
    channel: "canary",
    strategy: "dynamic-ssr",
    timeoutMs: 200,
    required: false,
  },
  {
    name: "accountBar",
    fragment: "account-bar",
    channel: "canary",
    strategy: "dynamic-ssr",
    timeoutMs: 200,
    dataDependencies: ["trade-account"],
    required: false,
  },
  {
    name: "fundingBar",
    fragment: "funding-bar",
    channel: "canary",
    strategy: "cached-ssr",
    timeoutMs: 200,
    cachePolicy: {
      ttl: 30,
      tags: ["funding", "trade"],
      vary: ["locale", "props"],
    },
    required: false,
  },
  {
    name: "chart",
    fragment: "chart-panel",
    channel: "canary",
    strategy: "ttl-cache",
    timeoutMs: 200,
    cachePolicy: {
      ttl: 60,
      tags: ["candles", "trade"],
      vary: ["locale", "props"],
    },
    required: false,
  },
];
