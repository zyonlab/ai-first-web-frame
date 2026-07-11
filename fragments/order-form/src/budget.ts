/**
 * order-form fragment budget (hard gate, spine §5/§13).
 *
 * The fragment ships NO React/Radix of its own: the tsdown browser build of
 * `island.browser.ts` (C3 spike, §4.3.3) externalizes `react`,
 * `react/jsx-runtime`, `react-dom/client`, `@mvp/trade-contracts`, and
 * `@mvp/ui/shadcn` — they resolve at runtime via `apps/page-trade`'s shared
 * vendor chunk + import map, not this bundle. The fragment's own JS is only
 * its island glue (islandLogic/placeOrderFlow + the OrderFormIsland
 * component itself): ~4.6KB minified as measured
 * (`dist-browser/island.browser.js`), well under this 30KB budget. This
 * `jsBytes`/`cssBytes` pair is now a REAL gate — the "declarative only" gap
 * the C3 spike flagged here (§4.3.3) is closed: `tools/bundle-budget-check`
 * bundles `src/island.browser.ts` with the same externals and fails
 * `pnpm verify` when the minified bytes exceed `jsBytes`, and
 * `tools/css-budget-check` gates the fragment's minified source CSS against
 * `cssBytes`.
 */
export const orderFormBudget = {
  scope: "fragment",
  name: "order-form",
  jsBytes: 30000,
  cssBytes: 10000,
  maxFragmentLatencyMs: 200,
  maxRenderMs: 50,
  maxMemoryMB: 20,
} as const;
