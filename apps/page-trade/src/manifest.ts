import { tradePageBudget } from "./budget";
import tradePageSlots from "./manifest.slots.json";

export const tradePageManifest = {
  name: "page-trade",
  route: "/trade/:symbol",
  owner: "trading-core",
  version: "0.1.0",
  renderMode: "hybrid",
  renderStrategy: "hybrid",
  seo: {
    title: "MVP Perps — Trade Terminal",
    description:
      "Server-rendered perpetuals trade terminal composing the order book, order form, market header, and account panels into one dense grid.",
  },
  // Verified against src/fragmentSlots.ts + src/hydrate.tsx +
  // src/hydrateSpike.tsx + src/spikeImportMap.ts + fragment manifests
  // (e.g. fragments/order-book/src/manifest.ts):
  //  - dag-scheduling — executeFragmentSlots runs with a `trade-account`
  //    data-dependency node shared by orderForm/positions/accountBar
  //    (resolved once, fanned out to every dependent slot).
  //  - cross-island-interaction:typed-bus — registerTradeIslands wires
  //    market-header/chart/account-bar onto one shared InteractionBus,
  //    publishing typed `@mvp/trade-contracts` slices
  //    (TRADE_ACTIVE_SYMBOL, TRADE_ORDER_DRAFT_PRICE, TRADE_LEVERAGE).
  //  - island-version-handshake — every registerIsland() call passes
  //    `expectedVersion` from the fragment's own manifest version; a
  //    drifted SSR snapshot skips hydration instead of mis-hydrating (C2).
  //  - layout-hints — trade fragments (e.g. order-book) declare a
  //    `layoutHint` (`{ shape, fills, minHeight }`) that
  //    tools/release-tools/src/layout-advisories.ts turns into mount-time
  //    warnings for this page's dense grid.
  //  - runtime-island-assets:spike — hydrateSpike.tsx + spikeImportMap.ts
  //    dynamically `import()` the order-form island via its registry
  //    `assetsUrl` through a browser import map (C3 spike, order-form only).
  demonstrates: [
    "dag-scheduling",
    "cross-island-interaction:typed-bus",
    "island-version-handshake",
    "layout-hints",
    "runtime-island-assets:spike",
  ],
  slots: tradePageSlots,
  budget: tradePageBudget,
} as const;

export function validateTradePageManifest(
  manifest = tradePageManifest,
): boolean {
  return Boolean(
    manifest.route &&
      manifest.renderMode &&
      manifest.seo &&
      manifest.budget &&
      manifest.slots.length > 0,
  );
}
