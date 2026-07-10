import { createElement, type ReactElement, useEffect, useRef } from "react";

/** A single OHLC candle. `time` is only used for ordering/labels. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** A price level on one side of the book. */
export interface DepthLevel {
  price: number;
  size: number;
}

/** L2 depth book: bids (descending price) and asks (ascending price). */
export interface DepthBook {
  bids: DepthLevel[];
  asks: DepthLevel[];
}

/** Geometry + optional overrides shared by the draw functions. */
export interface DrawOptions {
  width: number;
  height: number;
  /** Inner padding in px (default 4). Padding 0 makes extremes touch edges. */
  padding?: number;
  /** Explicit colors; when omitted they are resolved from CSS variables. */
  colors?: ChartColors;
}

/** Resolved semantic colors used by the renderer. */
export interface ChartColors {
  buy: string;
  sell: string;
  grid: string;
  text: string;
}

/** Minimal structural subset of what {@link resolveChartColors} reads. */
export interface StyleSource {
  getPropertyValue(name: string): string;
}

const DEFAULT_COLORS: ChartColors = {
  buy: "#16a34a",
  sell: "#dc2626",
  grid: "#334155",
  text: "#e2e8f0",
};

/**
 * Resolves chart colors from a CSS-variable source (typically
 * `getComputedStyle(canvas)`), so the chart follows the active theme's
 * `--mvp-color-buy` / `--mvp-color-sell` / grid / text tokens. Any token that
 * is absent or blank falls back to a sensible default, so the renderer works
 * even before the design-system tokens are wired.
 */
export function resolveChartColors(
  source: StyleSource | undefined,
): ChartColors {
  if (!source) return { ...DEFAULT_COLORS };
  const read = (name: string, fallback: string): string => {
    const value = source.getPropertyValue(name);
    return value?.trim() ? value.trim() : fallback;
  };
  return {
    buy: read("--mvp-color-buy", DEFAULT_COLORS.buy),
    sell: read("--mvp-color-sell", DEFAULT_COLORS.sell),
    grid: read("--mvp-color-grid", DEFAULT_COLORS.grid),
    text: read("--mvp-color-text", DEFAULT_COLORS.text),
  };
}

function priceExtent(values: number[]): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/**
 * Draws a candlestick series onto a 2D canvas context. Pure canvas 2D — no
 * external charting dependency (README §14 D2). Y maps the global [low, high]
 * price extent onto the padded height (inverted, so higher price = smaller y).
 * Up candles (close >= open) use the buy color, down candles the sell color.
 */
export function drawCandles(
  ctx: CanvasRenderingContext2D,
  series: Candle[],
  opts: DrawOptions,
): void {
  const { width, height } = opts;
  const padding = opts.padding ?? 4;
  ctx.clearRect(0, 0, width, height);
  if (series.length === 0) return;

  const colors = opts.colors ?? DEFAULT_COLORS;
  const { min, max } = priceExtent(series.flatMap((c) => [c.high, c.low]));
  const span = max - min || 1;
  const innerH = height - padding * 2;
  const innerW = width - padding * 2;
  const slot = innerW / series.length;
  const bodyW = Math.max(1, slot * 0.6);

  const y = (price: number): number =>
    padding + (1 - (price - min) / span) * innerH;

  for (let i = 0; i < series.length; i += 1) {
    const c = series[i];
    const cx = padding + slot * (i + 0.5);
    const up = c.close >= c.open;
    const color = up ? colors.buy : colors.sell;

    // Wick: high → low centered on the slot.
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, y(c.high));
    ctx.lineTo(cx, y(c.low));
    ctx.stroke();

    // Body: open ↔ close rectangle.
    const yOpen = y(c.open);
    const yClose = y(c.close);
    const top = Math.min(yOpen, yClose);
    const bodyH = Math.max(1, Math.abs(yClose - yOpen));
    ctx.fillStyle = color;
    ctx.fillRect(cx - bodyW / 2, top, bodyW, bodyH);
  }
}

/**
 * Draws a cumulative depth chart from an L2 book. Bids fill from the mid to the
 * left with the buy color; asks fill from the mid to the right with the sell
 * color. Each side is drawn as a single filled step area. Pure canvas 2D.
 */
export function drawDepth(
  ctx: CanvasRenderingContext2D,
  book: DepthBook,
  opts: DrawOptions,
): void {
  const { width, height } = opts;
  const padding = opts.padding ?? 4;
  ctx.clearRect(0, 0, width, height);
  const { bids, asks } = book;
  if (bids.length === 0 && asks.length === 0) return;

  const colors = opts.colors ?? DEFAULT_COLORS;
  const innerH = height - padding * 2;
  const mid = width / 2;

  // Cumulative size defines the y (depth) axis; larger cumulative = taller.
  const cum = (levels: DepthLevel[]): number[] => {
    let total = 0;
    return levels.map((l) => {
      total += l.size;
      return total;
    });
  };
  const bidCum = cum(bids);
  const askCum = cum(asks);
  const maxCum = Math.max(0, ...bidCum, ...askCum) || 1;

  const yFor = (c: number): number => padding + (1 - c / maxCum) * innerH;

  // Bids: mid → left.
  if (bids.length > 0) {
    ctx.fillStyle = colors.buy;
    ctx.beginPath();
    ctx.moveTo(mid, height - padding);
    let x = mid;
    for (let i = 0; i < bids.length; i += 1) {
      const nextX = mid - (mid - padding) * ((i + 1) / bids.length);
      ctx.lineTo(x, yFor(bidCum[i]));
      ctx.lineTo(nextX, yFor(bidCum[i]));
      x = nextX;
    }
    ctx.lineTo(x, height - padding);
    ctx.fill();
  }

  // Asks: mid → right.
  if (asks.length > 0) {
    ctx.fillStyle = colors.sell;
    ctx.beginPath();
    ctx.moveTo(mid, height - padding);
    let x = mid;
    for (let i = 0; i < asks.length; i += 1) {
      const nextX = mid + (width - padding - mid) * ((i + 1) / asks.length);
      ctx.lineTo(x, yFor(askCum[i]));
      ctx.lineTo(nextX, yFor(askCum[i]));
      x = nextX;
    }
    ctx.lineTo(x, height - padding);
    ctx.fill();
  }
}

/** Props for the {@link CandleChart} React wrapper. */
export interface CandleChartProps {
  series: Candle[];
  interval: string;
  width?: number;
  height?: number;
}

/**
 * React wrapper around {@link drawCandles}. Holds a `<canvas>` via ref and
 * (re)draws on `series`/geometry change, resolving colors from the canvas's
 * computed style so it themes automatically. The chart adapter interface the
 * trace UI (doc 08) also consumes is `drawCandles`/`drawDepth` directly; this
 * wrapper is the convenience island view.
 */
export function CandleChart({
  series,
  interval,
  width = 320,
  height = 160,
}: CandleChartProps): ReactElement {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof canvas.getContext !== "function") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const colors =
      typeof window !== "undefined" && typeof getComputedStyle === "function"
        ? resolveChartColors(getComputedStyle(canvas))
        : undefined;
    drawCandles(ctx, series, { width, height, colors });
  }, [series, width, height]);

  return createElement(
    "div",
    {
      "data-island-view": "candle-chart",
      "data-interval": interval,
    },
    createElement("canvas", { ref, width, height }),
  );
}
