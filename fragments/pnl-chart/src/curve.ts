/**
 * Pure PnL-curve geometry for the pnl-chart fragment. These are the only "logic"
 * units and are fully deterministic given their inputs — no clock, no DOM, no
 * randomness. The SSR render turns the resulting points into an inline `<svg>`
 * `<polyline>`; there is deliberately NO chart library and NO client JS, so this
 * module IS the chart. Everything here is exhaustively unit-tested (determinism,
 * empty/single-point series, flat-series normalization, viewBox edges).
 */

/** One sample of the equity / cumulative-PnL time series. */
export type PnlPoint = {
  /** Sample timestamp (ms). */
  t: number;
  /** Account equity at this sample (baseline + cumulative PnL). */
  equity: number;
  /** Cumulative PnL relative to the series baseline (equity - baseline). */
  pnl: number;
};

/** A point in SVG user space (post-normalization). */
export type SvgPoint = { x: number; y: number };

/** viewBox the series is normalized into. Y grows downward in SVG. */
export type ViewBox = { width: number; height: number; padding: number };

/** The default plot box the render uses; kept here so tests share one source. */
export const DEFAULT_VIEWBOX: ViewBox = { width: 320, height: 120, padding: 8 };

/**
 * Result of projecting a PnL series into the viewBox. `points`/`path` are ready
 * to drop into `<polyline points>` / `<path d>`; `area` closes the polyline down
 * to the baseline for an up/down tinted fill; `baselineY` is the y of the series
 * start (zero-PnL line) so the render can draw a reference line and split fill.
 */
export type PnlPolyline = {
  points: SvgPoint[];
  /** `"x,y x,y ..."` for `<polyline points>`. */
  pointsAttr: string;
  /** `"M x y L x y ..."` for `<path d>` (same geometry as `points`). */
  path: string;
  /** Closed area path from the curve down to the plot floor (for fill). */
  areaPath: string;
  /** y of the first sample — the visual zero-PnL baseline. */
  baselineY: number;
  min: number;
  max: number;
  viewBox: ViewBox;
};

/** Options for {@link buildEquityCurve}. */
export type BuildCurveOptions = {
  /** Starting equity the walk is anchored to. Defaults to 100_000. */
  baseline?: number;
  /**
   * Notional "position size" the candle returns are applied against to turn a
   * price walk into a PnL walk. Defaults to 1 (PnL == cumulative price delta).
   */
  size?: number;
};

/** A candle close feeding the curve (structurally a subset of `@mvp/trade-data` `Candle`). */
export type CurveCandle = { openTime: number; close: number };

/**
 * Rounds to 2 decimals with a stable half-up rule so serialized PnL is identical
 * across runs and platforms (no `-0`, no float dust in golden SVG snapshots).
 */
function round2(value: number): number {
  const r = Math.round((value + Number.EPSILON) * 100) / 100;
  return r === 0 ? 0 : r;
}

/**
 * Synthesizes a deterministic equity / cumulative-PnL series from a candle
 * history. PnL at sample _i_ is `size * (close_i - close_0)` — i.e. the mark-to
 * -market of a fixed `size` position opened at the first close. This is a pure
 * function of the (deterministic) candle fixtures, so the whole curve is stable.
 * An empty candle list yields an empty series; a single candle yields one point
 * at zero PnL.
 */
export function buildEquityCurve(
  candles: CurveCandle[],
  options: BuildCurveOptions = {},
): PnlPoint[] {
  const baseline = options.baseline ?? 100_000;
  const size = options.size ?? 1;
  if (candles.length === 0) return [];
  const entry = candles[0].close;
  return candles.map((candle) => {
    const pnl = round2(size * (candle.close - entry));
    return { t: candle.openTime, equity: round2(baseline + pnl), pnl };
  });
}

/** Period return of a series: last cumulative PnL over the baseline equity. */
export function periodReturnPct(
  series: PnlPoint[],
  baseline = 100_000,
): number {
  if (series.length === 0 || baseline === 0) return 0;
  const last = series[series.length - 1];
  return round2((last.pnl / baseline) * 100);
}

/** The latest cumulative PnL of a series (0 for an empty series). */
export function latestPnl(series: PnlPoint[]): number {
  return series.length === 0 ? 0 : series[series.length - 1].pnl;
}

/**
 * up = series ends in profit, down = in loss, flat = exactly flat/empty. Drives
 * the semantic fill/stroke color in the render (no color logic in the template).
 */
export function pnlDirection(series: PnlPoint[]): "up" | "down" | "flat" {
  const pnl = latestPnl(series);
  if (pnl > 0) return "up";
  if (pnl < 0) return "down";
  return "flat";
}

/**
 * Projects a PnL series into SVG user space, normalized to `viewBox`.
 *
 * X is spread evenly across the inner width (first sample at left padding, last
 * at right padding); a single point is centered. Y maps `pnl` linearly into the
 * inner height, inverted (SVG y grows down) so higher PnL sits higher. A flat
 * series (min == max, including the single-point case) is pinned to the vertical
 * center so no division by zero and no degenerate line off-canvas.
 */
export function toPolyline(
  series: PnlPoint[],
  viewBox: ViewBox = DEFAULT_VIEWBOX,
): PnlPolyline {
  const { width, height, padding } = viewBox;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const values = series.map((p) => p.pnl);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const span = max - min;

  const yFor = (pnl: number): number => {
    // Flat series → center line; otherwise invert into the inner height.
    if (span === 0) return round2(padding + innerH / 2);
    const norm = (pnl - min) / span; // 0..1, min→0, max→1
    return round2(padding + (1 - norm) * innerH);
  };

  const xFor = (index: number): number => {
    if (series.length <= 1) return round2(padding + innerW / 2);
    return round2(padding + (index / (series.length - 1)) * innerW);
  };

  const points: SvgPoint[] = series.map((p, i) => ({
    x: xFor(i),
    y: yFor(p.pnl),
  }));

  const pointsAttr = points.map((p) => `${p.x},${p.y}`).join(" ");
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  const floorY = round2(height - padding);
  const areaPath =
    points.length === 0
      ? ""
      : `${path} L ${points[points.length - 1].x} ${floorY}` +
        ` L ${points[0].x} ${floorY} Z`;

  // Baseline = y of the first (zero-PnL) sample; for an empty series, the floor.
  const baselineY = points.length === 0 ? floorY : yFor(0);

  return {
    points,
    pointsAttr,
    path,
    areaPath,
    baselineY,
    min,
    max,
    viewBox,
  };
}

/** Formats a signed USD PnL value, e.g. `+$157.05` / `-$4.20`. */
export function formatPnl(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${abs}`;
}

/** Formats a signed percentage, e.g. `+0.16%` / `-0.03%`. */
export function formatReturnPct(value: number, decimals = 2): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}
