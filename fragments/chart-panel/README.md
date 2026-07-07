# @mvp/fragment-chart-panel

SSR candlestick-chart fragment for the trade demo (A2-chart slot). Serves a
server-safe first paint (canvas placeholder + interval control + latest-candle
O/H/L/C summary) plus a `data-island="chart"` React island that hydrates through
`@mvp/trade-client` and draws candles with the shared canvas renderer.

Default port **4211**. Endpoints: `/health /metrics /manifest /assets /budget`
and `POST /render`.

- **Render** (`src/render.ts`): ISR candle-history bootstrap via C4
  `createTradeDataClient(ctx).readData(sourceIds.candlesHistory(symbol, interval))`
  (C5), seeded from the frozen `seedCandles` fixtures. Emits the canvas
  placeholder, an interval chip group (`1m/5m/15m/1h/4h/1d`), the latest-candle
  O/H/L/C summary (up/down semantic color), and the frozen C2 island snapshot
  `<div data-island="chart"><script type="application/json">{props:{symbol,interval,series},slice}</script></div>`
  (`slice = trade.chart-interval`). The `series` is the full initial candle
  array so the island's canvas paints with zero flash. No-JS first paint stays
  readable (summary + placeholder).
- **Island** (`src/island.tsx`, `"use client"`): draws the series with the
  shared `<CandleChart>` (canvas 2D `drawCandles`, README §14 D2 — no external
  chart library); the shadcn `Tabs` interval control publishes
  `trade.chart-interval` (C3, `isChartInterval`-guarded), refetches history for
  the new interval via C4, and re-subscribes the live candle
  (`sourceIds.candles(symbol, interval)`); subscribes to `trade.active-symbol`
  to refetch + resubscribe on a symbol switch, and echoes its own
  `trade.chart-interval`.
- **Pure logic** (`src/islandLogic.ts`): candle mapper (`toChartCandle`),
  live-frame fold with **replace/append** semantics (`applyLiveCandle`), interval
  reducer (`intervalReducer`), interval publish payload (`buildIntervalPayload`),
  and the OHLC summary (`summarizeSeries`) — all unit-tested with no DOM/React.

React + the canvas renderer are NOT bundled here — they ship once via the shared
`@mvp/trade-client` chunk; the interval `Tabs` ship via `@mvp/ui/shadcn`. Both
are declared as shared dependencies in the manifest and deduped by `@mvp/assets`.

Register (run by agent K, not here):

```
pnpm exec tsx scripts/register-fragment.mts \
  --name chart-panel --version 0.1.0 \
  --service-url http://localhost:4211 --channel canary
```
