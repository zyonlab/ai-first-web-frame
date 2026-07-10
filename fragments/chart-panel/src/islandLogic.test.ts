import type { CandleFrame, Candle as DataCandle } from "@mvp/data";
import type { Candle as ChartCandle } from "@mvp/trade-chart";
import { describe, expect, it } from "vitest";
import {
  applyLiveCandle,
  buildIntervalPayload,
  intervalReducer,
  summarizeSeries,
  toChartCandle,
  toChartSeries,
} from "./islandLogic";

/** Builds a deterministic data-plane candle for the mapper/fold tests. */
function dataCandle(overrides: Partial<DataCandle> = {}): DataCandle {
  return {
    openTime: 0,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 5,
    ...overrides,
  };
}

/** Wraps a data candle in a `candles.live` frame. */
function liveFrame(candle: DataCandle, closed = false): CandleFrame {
  return {
    channel: "candles.live",
    symbol: "BTC",
    interval: "1m",
    seq: 1,
    ts: 1000,
    candle,
    closed,
  };
}

describe("toChartCandle (data candle -> chart candle)", () => {
  it("maps openTime->time and drops volume (OHLC only)", () => {
    const chart = toChartCandle(
      dataCandle({ openTime: 60000, open: 1, high: 2, low: 0.5, close: 1.5 }),
    );
    expect(chart).toEqual({
      time: 60000,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
    });
    // No `volume` key leaks into the chart candle.
    expect(Object.hasOwn(chart, "volume")).toBe(false);
  });

  it("maps a whole history array deterministically", () => {
    const history = [
      dataCandle({ openTime: 0 }),
      dataCandle({ openTime: 60000 }),
    ];
    const series = toChartSeries(history);
    expect(series).toHaveLength(2);
    expect(series[0].time).toBe(0);
    expect(series[1].time).toBe(60000);
  });
});

describe("applyLiveCandle (replace / append semantics)", () => {
  const base: ChartCandle[] = [
    { time: 0, open: 100, high: 101, low: 99, close: 100.5 },
    { time: 60000, open: 100.5, high: 102, low: 100, close: 101 },
  ];

  it("REPLACES the last candle when the frame shares its time (still forming)", () => {
    const next = applyLiveCandle(
      base,
      liveFrame(dataCandle({ openTime: 60000, close: 101.8, high: 102.5 })),
    );
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({
      time: 60000,
      open: 100,
      high: 102.5,
      low: 90,
      close: 101.8,
    });
    // A new array reference so React re-renders.
    expect(next).not.toBe(base);
  });

  it("APPENDS a new candle when the frame time is newer (a candle closed)", () => {
    const next = applyLiveCandle(
      base,
      liveFrame(dataCandle({ openTime: 120000, close: 102 }), true),
    );
    expect(next).toHaveLength(3);
    expect(next[2].time).toBe(120000);
    expect(next[2].close).toBe(102);
    // Earlier candles are untouched.
    expect(next[0]).toBe(base[0]);
    expect(next[1]).toBe(base[1]);
  });

  it("IGNORES an older/stale frame (same reference, idempotent)", () => {
    const next = applyLiveCandle(
      base,
      liveFrame(dataCandle({ openTime: 30000, close: 999 })),
    );
    expect(next).toBe(base);
  });

  it("SEEDS from the frame when the series is empty", () => {
    const next = applyLiveCandle(
      [],
      liveFrame(dataCandle({ openTime: 60000, close: 7 })),
    );
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({
      time: 60000,
      open: 100,
      high: 110,
      low: 90,
      close: 7,
    });
  });

  it("folds a run of frames into a stable series (replace then append)", () => {
    let series: ChartCandle[] = [];
    series = applyLiveCandle(
      series,
      liveFrame(dataCandle({ openTime: 0, close: 100 })),
    );
    series = applyLiveCandle(
      series,
      liveFrame(dataCandle({ openTime: 0, close: 101 })),
    );
    series = applyLiveCandle(
      series,
      liveFrame(dataCandle({ openTime: 60000, close: 102 })),
    );
    expect(series).toHaveLength(2);
    expect(series[0].close).toBe(101);
    expect(series[1].close).toBe(102);
  });
});

describe("intervalReducer (interval switch)", () => {
  it("replaces the current interval with a valid new one", () => {
    expect(intervalReducer("1m", "5m")).toBe("5m");
    expect(intervalReducer("1m", "1h")).toBe("1h");
  });

  it("is idempotent when the interval is unchanged", () => {
    expect(intervalReducer("15m", "15m")).toBe("15m");
  });

  it("rejects an invalid interval (keeps the current)", () => {
    expect(intervalReducer("1m", "3s")).toBe("1m");
    expect(intervalReducer("1m", "")).toBe("1m");
    expect(intervalReducer("1m", 5)).toBe("1m");
    expect(intervalReducer("1m", undefined)).toBe("1m");
  });
});

describe("buildIntervalPayload (C3 TRADE_CHART_INTERVAL publish, isChartInterval-guarded)", () => {
  it("builds a valid payload for a known interval", () => {
    expect(buildIntervalPayload("4h")).toEqual({ interval: "4h" });
    expect(buildIntervalPayload("1d")).toEqual({ interval: "1d" });
  });

  it("returns undefined for an invalid interval (never publishes)", () => {
    expect(buildIntervalPayload("2m")).toBeUndefined();
    expect(buildIntervalPayload(60)).toBeUndefined();
    expect(buildIntervalPayload(null)).toBeUndefined();
  });
});

describe("summarizeSeries (latest-candle O/H/L/C + direction)", () => {
  it("summarizes the last candle and flags an up move", () => {
    const summary = summarizeSeries([
      { time: 0, open: 100, high: 110, low: 90, close: 105 },
    ]);
    expect(summary).toEqual({
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      direction: "up",
    });
  });

  it("flags a down move and a flat candle", () => {
    expect(
      summarizeSeries([{ time: 0, open: 105, high: 106, low: 100, close: 101 }])
        ?.direction,
    ).toBe("down");
    expect(
      summarizeSeries([{ time: 0, open: 100, high: 101, low: 99, close: 100 }])
        ?.direction,
    ).toBe("flat");
  });

  it("returns null for an empty series", () => {
    expect(summarizeSeries([])).toBeNull();
  });
});
