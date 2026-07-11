# @mvp/trade-chart — AGENT.md

## What this package is for

`@mvp/trade-chart` is the trade demo's chart renderer: pure canvas-2D
candlestick (`drawCandles`) and cumulative L2 depth (`drawDepth`) drawing
functions — no external charting dependency — plus a thin `CandleChart` React
wrapper that holds a `<canvas>` and redraws on data/geometry change. Colors
resolve at draw time from CSS custom properties (`--trade-buy`/`--trade-sell`,
the trade-owned, theme-scoped tokens `@mvp/trade-theme` emits, plus
`--mvp-color-grid`/`--mvp-color-text` from `@mvp/design-system`), so the chart
follows the active `data-theme` without prop plumbing; any absent token falls
back to a built-in default so the renderer works before the trade-theme bridge
is wired. It was moved out of `packages/trade-client/chart.tsx` in the P1
re-layering (docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2, flagged "demo-only") —
charting a specific asset's candles/depth is trade-domain code, not a
framework primitive. It is a **domain-layer** package (§2.1): it may import
framework packages (its only deps are the `react`/`react-dom` peers) but
`packages/**` must never import it back; imports only point downward, enforced
by the `auditPackageLayering` dependency-audit check. Not npm-published. The
chart adapter interface other consumers (e.g. the trace UI, doc 08) use is
`drawCandles`/`drawDepth` directly; `CandleChart` is the convenience island
view.

## Entry points

- `Candle = { time: number, open: number, high: number, low: number, close: number }`
  — one OHLC candle; `time` is only used for ordering/labels.
- `DepthLevel = { price: number, size: number }` /
  `DepthBook = { bids: DepthLevel[], asks: DepthLevel[] }` — L2 book (bids
  descending price, asks ascending price).
- `DrawOptions = { width: number, height: number, padding?: number, colors?: ChartColors }`
  — geometry shared by both draw functions; `padding` defaults to 4 (0 makes
  extremes touch the edges); omit `colors` to use built-in defaults.
- `ChartColors = { buy: string, sell: string, grid: string, text: string }` —
  resolved semantic colors the renderer uses.
- `StyleSource = { getPropertyValue(name: string): string }` — minimal
  structural subset of `CSSStyleDeclaration` that `resolveChartColors` reads.
- `resolveChartColors(source: StyleSource | undefined): ChartColors` — reads
  `--trade-buy`, `--trade-sell`, `--mvp-color-grid`, `--mvp-color-text` from
  `source` (typically `getComputedStyle(canvas)`); an `undefined` source or
  any absent/blank token falls back to that key's default.
- `drawCandles(ctx: CanvasRenderingContext2D, series: Candle[], opts: DrawOptions): void`
  — clears the rect, then draws one wick (high→low stroke) and one body
  (open↔close fill) per candle. Y maps the global [low, high] extent onto the
  padded height (inverted); up candles (`close >= open`) use `colors.buy`,
  down candles `colors.sell`. An empty series only clears.
- `drawDepth(ctx: CanvasRenderingContext2D, book: DepthBook, opts: DrawOptions): void`
  — clears, then draws one filled cumulative step area per side: bids from
  the mid to the left in `colors.buy`, asks from the mid to the right in
  `colors.sell`. An empty book only clears.
- `CandleChart(props: CandleChartProps): ReactElement` — `CandleChartProps =
  { series: Candle[], interval: string, width?: number = 320, height?: number = 160 }`.
  Renders `<div data-island-view="candle-chart" data-interval={interval}>`
  around a `<canvas>`; a `useEffect` redraws via `drawCandles` on
  `series`/`width`/`height` change, resolving colors from the canvas's
  computed style (`resolveChartColors(getComputedStyle(canvas))`) so it
  themes automatically. Guards missing `window`/`getContext` (SSR, test DOMs
  without canvas) by skipping the draw, never by throwing.

## Error taxonomy

Nothing throws, by design: the draw functions are pure synchronous canvas
calls with no I/O or validation path — an empty `series`/`book` is a
clear-only no-op, not an error; `resolveChartColors` degrades to defaults
instead of failing on missing tokens; and `CandleChart`'s effect returns early
when the canvas ref is unset, `getContext` is absent (non-canvas test DOMs),
or `getContext("2d")` yields null. A chart is presentation-only demo chrome —
there is no state a failure here could corrupt, so every degraded input path
draws less rather than throwing. (As with any canvas code, a `ctx` that is not
actually a 2D context fails inside the canvas API itself — a caller bug, not
an API error condition.)

## Example

```ts
import {
  type Candle,
  type DepthBook,
  drawCandles,
  drawDepth,
  resolveChartColors,
} from "@mvp/trade-chart";

// 1. Colors resolve from a CSS-variable source (getComputedStyle(canvas) in a
//    real page); absent tokens fall back to built-in defaults.
const colors = resolveChartColors({
  getPropertyValue: (name: string) => (name === "--trade-buy" ? "#0f9d58" : ""),
});
console.log(colors.buy); // "#0f9d58" (from the source)
console.log(colors.sell.length > 0); // true (fallback default)

// 2. A minimal recording stand-in for the CanvasRenderingContext2D members
//    the renderer touches — the same technique the package's own tests use.
const calls = { clearRect: 0, fillRect: 0, wicks: 0, fill: 0 };
const ctx = {
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  clearRect: () => {
    calls.clearRect += 1;
  },
  fillRect: () => {
    calls.fillRect += 1;
  },
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {
    calls.wicks += 1;
  },
  fill: () => {
    calls.fill += 1;
  },
} as unknown as CanvasRenderingContext2D;

// 3. Candles: one body fill + one wick stroke per candle.
const series: Candle[] = [
  { time: 1, open: 10, high: 14, low: 8, close: 12 }, // up -> buy color
  { time: 2, open: 12, high: 16, low: 11, close: 11 }, // down -> sell color
];
drawCandles(ctx, series, { width: 200, height: 100, colors });
console.log(calls.clearRect); // 1
console.log(calls.fillRect); // 2 (one body per candle)
console.log(calls.wicks); // 2 (one wick per candle)

// 4. Depth: one filled cumulative step area per side of the book.
const book: DepthBook = {
  bids: [
    { price: 100, size: 3 },
    { price: 99, size: 5 },
  ],
  asks: [
    { price: 101, size: 2 },
    { price: 102, size: 6 },
  ],
};
drawDepth(ctx, book, { width: 200, height: 100, colors });
console.log(calls.fill); // 2 (bids area + asks area)

// 5. Empty inputs are clear-only no-ops, never errors.
drawCandles(ctx, [], { width: 200, height: 100 });
console.log(calls.fillRect); // still 2
```

## Accept

```
pnpm --filter @mvp/trade-chart test
```
Expected: Vitest exits 0. `domains/trade-chart/src/index.test.ts` covers
`resolveChartColors`' token reads and fallbacks, `drawCandles`' one-body-plus-
one-wick-per-candle output and high/low → top/bottom y-mapping (via a
recording mock context), `drawDepth`'s one-filled-area-per-side output, the
empty-series/empty-book clear-only no-ops, and that `CandleChart` renders a
`<canvas>` with the `data-interval` label.
