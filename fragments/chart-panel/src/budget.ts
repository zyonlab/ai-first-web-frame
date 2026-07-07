/**
 * chart-panel fragment budget (hard gate, spine §5/§13; README §14 D2/D3).
 *
 * The fragment ships NO chart library and NO React of its own: React, the
 * canvas candle renderer (`drawCandles` / `CandleChart`), the island runtime and
 * the store client all live in the shared `@mvp/trade-client` chunk, and the
 * shadcn Tabs interval control lives in `@mvp/ui/shadcn` — both declared in the
 * manifest's `assets.js` as shared dependencies (deduped by `@mvp/assets`). The
 * fragment's own JS is only the island glue that reads the inline candle
 * snapshot and calls `mountIsland`, plus the pure series/interval logic. That is
 * well under the shared 30KB fragment JS budget. CSS is the scoped chart panel
 * stylesheet only. Both budgets match the reference gate (30KB / 10KB).
 */
export const chartPanelBudget = {
  scope: "fragment",
  name: "chart-panel",
  jsBytes: 30000,
  cssBytes: 10000,
  maxFragmentLatencyMs: 200,
  maxRenderMs: 50,
  maxMemoryMB: 20,
} as const;
