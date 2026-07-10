import type { CandleFrame, Candle as DataCandle } from "@mvp/data";
import type { Candle as ChartCandle } from "@mvp/trade-chart";
import {
  type ChartInterval,
  type ChartIntervalPayload,
  isChartInterval,
} from "@mvp/trade-contracts";

/**
 * Pure island logic for the chart-panel (contract C2/C3/C4/C5 realized).
 *
 * Everything the `chart` island does to its candle series and interval state is
 * expressed here as pure functions/reducers so it can be unit-tested with no
 * DOM/React/canvas:
 *
 * - `toChartCandle` — projects a data-plane OHLCV candle
 *   (`{ openTime, open, high, low, close, volume }`, C5 `candles.*`) onto the
 *   chart renderer's `Candle` shape (`{ time, open, high, low, close }`,
 *   README §14 D2). `openTime` becomes `time`; volume is dropped (the candle
 *   renderer draws OHLC only). Keeping this a pure mapper means SSR and the
 *   island agree byte-for-byte on the initial series.
 * - `applyLiveCandle` — folds a live `candles.live` frame into the series with
 *   the **replace / append** semantics: a frame whose candle shares the last
 *   candle's `time` is still forming, so it REPLACES the last candle; a frame
 *   with a newer `time` opened a fresh candle, so it APPENDS. Older/duplicate
 *   frames are ignored (idempotent). An empty series seeds from the frame.
 * - `intervalReducer` — the interval-control reducer: a valid new interval
 *   replaces the current one (idempotent when unchanged); an invalid value is
 *   rejected (returns the current interval).
 * - `buildIntervalPayload` — the C3 `TRADE_CHART_INTERVAL` publish payload for a
 *   chosen interval, guarded by `isChartInterval` so an invalid interval never
 *   goes on the bus.
 *
 * None of these touch the bus, the DOM, or a canvas; the island component wires
 * them to subscriptions/events and the store. This keeps the chart flows
 * deterministic and fully testable.
 */

/**
 * Projects a data-plane OHLCV candle onto the chart renderer's `Candle` shape.
 * `openTime` → `time` (used only for ordering/labels by `drawCandles`); volume
 * is intentionally dropped since the candle renderer draws OHLC only.
 */
export function toChartCandle(candle: DataCandle): ChartCandle {
  return {
    time: candle.openTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

/** Maps a data-plane history array to the chart series (SSR + island seed). */
export function toChartSeries(history: DataCandle[]): ChartCandle[] {
  return history.map(toChartCandle);
}

/**
 * Folds a live `candles.live` frame into the chart series.
 *
 * Semantics (README §14 / data doc 03 §1 `candles.live`):
 *  - **replace** when the frame's candle shares the last candle's `time` — the
 *    last candle is still forming and this is its newer OHLC;
 *  - **append** when the frame's candle `time` is strictly greater — a new
 *    candle opened (the prior one has closed);
 *  - **ignore** an older or equal-but-stale duplicate (`time` < last) so late /
 *    out-of-order frames never corrupt the series (idempotent);
 *  - **seed** from the frame when the series is empty.
 *
 * The returned array is always a new reference on a real change so React can
 * re-render; on ignore the SAME reference is returned (no-op).
 */
export function applyLiveCandle(
  series: ChartCandle[],
  frame: CandleFrame,
): ChartCandle[] {
  const incoming = toChartCandle(frame.candle);
  if (series.length === 0) return [incoming];

  const last = series[series.length - 1];
  if (incoming.time > last.time) {
    // A new candle opened -> append.
    return [...series, incoming];
  }
  if (incoming.time === last.time) {
    // Still-forming candle -> replace the last in place.
    const next = series.slice(0, -1);
    next.push(incoming);
    return next;
  }
  // Older / stale frame -> ignore.
  return series;
}

/**
 * Interval-control reducer. A valid `ChartInterval` replaces `current`
 * (returning `current` unchanged when it already matches, so the caller can
 * skip a redundant refetch); an invalid value is rejected (returns `current`).
 */
export function intervalReducer(
  current: ChartInterval,
  next: unknown,
): ChartInterval {
  if (!isChartInterval(next)) return current;
  if (next === current) return current;
  return next;
}

/**
 * Builds the C3 `TRADE_CHART_INTERVAL` publish payload for a chosen interval.
 * Guarded by `isChartInterval` so an invalid interval never reaches the bus.
 * Returns `undefined` for an invalid interval (the caller skips the publish).
 */
export function buildIntervalPayload(
  interval: unknown,
): ChartIntervalPayload | undefined {
  if (!isChartInterval(interval)) return undefined;
  return { interval };
}

/**
 * Derives the static OHLC summary (latest candle open/high/low/close +
 * direction) the SSR first paint and the island both render. Pure so SSR and
 * hydration agree; direction drives the up/down semantic color class.
 */
export type ChartSummary = {
  open: number;
  high: number;
  low: number;
  close: number;
  /** "up" | "down" | "flat" from close vs open of the latest candle. */
  direction: "up" | "down" | "flat";
};

export function summarizeSeries(series: ChartCandle[]): ChartSummary | null {
  if (series.length === 0) return null;
  const last = series[series.length - 1];
  const direction: ChartSummary["direction"] =
    last.close > last.open ? "up" : last.close < last.open ? "down" : "flat";
  return {
    open: last.open,
    high: last.high,
    low: last.low,
    close: last.close,
    direction,
  };
}
