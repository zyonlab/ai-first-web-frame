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
 * (`dist-browser/island.browser.js`), well under this 30KB budget. Note this
 * `jsBytes`/`cssBytes` pair is declarative only — `tools/bundle-budget-check`
 * compares a root `stats.json` against `budget.json`, not this file's
 * numbers against the real built artifact; wiring the two together is a
 * real gap a full C3 rollout would need to close (spike finding, §4.3.3).
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
