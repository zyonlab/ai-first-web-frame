# pnl-chart fragment (A2-pnl slot)

Pure SSR equity / cumulative-PnL curve for the portfolio page. No React, no chart
library, **zero framework JS** — the chart is a hand-rolled inline `<svg>`
`<polyline>` rendered server-side and readable with JavaScript disabled.

- **Render strategy:** `isr`, `cachePolicy.ttl = 60s`, `tags: ["pnl"]`.
- **Data:** the equity curve is synthesized deterministically from the frozen
  **C4** client's `candles.history.<symbol>.<interval>` source (**C5**) — no
  dedicated equity source exists in the catalog, and candle history is seeded, so
  the whole curve is byte-stable. PnL = mark-to-market of a fixed-size position
  opened at the first close. Logical dep id: `pnl.history`.
- **Geometry is a pure function** (`src/curve.ts`): `buildEquityCurve` (candles →
  series) and `toPolyline` (series → normalized SVG points/path/area). Fully unit
  tested for determinism and the empty / single-point / flat / edge cases.
- **Endpoints:** `/health` (uptime) · `/metrics` · `/manifest` · `/assets` ·
  `/budget` · `POST /render`. Default port **4214**.

## Test

```
pnpm -w exec vitest run fragments/pnl-chart
```
