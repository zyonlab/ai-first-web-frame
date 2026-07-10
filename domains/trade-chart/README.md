# @mvp/trade-chart

The trade demo's self-contained canvas 2D candle/depth chart adapter
(`drawCandles`, `drawDepth`, `resolveChartColors`, the `CandleChart` React
wrapper). Demo-only, not a generic framework capability — moved here from
`packages/trade-client/src/chart.tsx` in the Phase P1 re-layering migration
(§2.2 Move A); see
[docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2](../../docs/ARCHITECTURE_REFACTOR_PLAN.md#22-moves-mechanical-one-pr-behavior-preserving).

Consumed by `fragments/chart-panel` (island + render) for the trade page's
candlestick chart.
