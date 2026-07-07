/**
 * order-form fragment budget (hard gate, spine §5/§13).
 *
 * The fragment ships NO React/Radix of its own: React, the shadcn Slider/Tabs/
 * Select, and the store client all live in the shared `@mvp/trade-client` +
 * `@mvp/ui/shadcn` chunks (declared in the manifest's `assets.js` as shared
 * dependencies, deduped by `@mvp/assets`). The fragment's own JS is only the
 * island glue that reads the inline snapshot and calls `mountIsland` — well
 * under the shared 30KB fragment JS budget. CSS is the scoped form stylesheet
 * only. Both budgets match the promotion-banner reference gate (30KB / 10KB).
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
