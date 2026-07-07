import { describe, expect, it } from "vitest";
import {
  buildEquityCurve,
  type CurveCandle,
  DEFAULT_VIEWBOX,
  formatPnl,
  formatReturnPct,
  latestPnl,
  type PnlPoint,
  periodReturnPct,
  pnlDirection,
  toPolyline,
  type ViewBox,
} from "../src/curve";

function candles(closes: number[], startTime = 1_000): CurveCandle[] {
  return closes.map((close, i) => ({
    openTime: startTime + i * 60_000,
    close,
  }));
}

describe("buildEquityCurve (pure: candles -> PnL series)", () => {
  it("anchors PnL at zero on the first close and marks each close to it", () => {
    const series = buildEquityCurve(candles([100, 110, 90, 120]), {
      baseline: 100_000,
      size: 1,
    });
    expect(series.map((p) => p.pnl)).toEqual([0, 10, -10, 20]);
    expect(series.map((p) => p.equity)).toEqual([
      100_000, 100_010, 99_990, 100_020,
    ]);
    // timestamps are carried through
    expect(series[1].t).toBe(1_000 + 60_000);
  });

  it("scales PnL by the notional size", () => {
    const series = buildEquityCurve(candles([100, 105]), { size: 4 });
    expect(latestPnl(series)).toBe(20); // 4 * (105 - 100)
  });

  it("returns an empty series for empty candle input (edge)", () => {
    expect(buildEquityCurve([])).toEqual([]);
  });

  it("returns a single zero-PnL point for a single candle (edge)", () => {
    const series = buildEquityCurve(candles([64_000]), { baseline: 100_000 });
    expect(series).toHaveLength(1);
    expect(series[0].pnl).toBe(0);
    expect(series[0].equity).toBe(100_000);
  });

  it("is deterministic: identical candles -> identical series", () => {
    const input = candles([1, 2, 3, 2, 5]);
    expect(buildEquityCurve(input)).toEqual(buildEquityCurve(input));
  });

  it("rounds to 2 decimals and never emits -0", () => {
    const series = buildEquityCurve(candles([100.005, 100.005]), { size: 1 });
    expect(Object.is(series[0].pnl, -0)).toBe(false);
    expect(series[0].pnl).toBe(0);
  });
});

describe("periodReturnPct / latestPnl / pnlDirection", () => {
  const up = buildEquityCurve(candles([100, 260]), { baseline: 100_000 });
  const down = buildEquityCurve(candles([100, 40]), { baseline: 100_000 });
  const flat = buildEquityCurve(candles([100, 100]), { baseline: 100_000 });

  it("computes period return as last PnL over baseline", () => {
    expect(periodReturnPct(up, 100_000)).toBe(0.16); // 160 / 100000 * 100
    expect(periodReturnPct(down, 100_000)).toBe(-0.06);
  });

  it("returns 0 for empty series or zero baseline", () => {
    expect(periodReturnPct([], 100_000)).toBe(0);
    expect(periodReturnPct(up, 0)).toBe(0);
  });

  it("classifies direction by the final PnL sign", () => {
    expect(pnlDirection(up)).toBe("up");
    expect(pnlDirection(down)).toBe("down");
    expect(pnlDirection(flat)).toBe("flat");
    expect(pnlDirection([])).toBe("flat");
  });
});

describe("toPolyline (pure: series -> normalized SVG geometry)", () => {
  const box: ViewBox = { width: 320, height: 120, padding: 8 };

  function series(pnls: number[]): PnlPoint[] {
    return pnls.map((pnl, i) => ({ t: i, equity: 100_000 + pnl, pnl }));
  }

  it("spreads X across the inner width, first at left pad, last at right pad", () => {
    const geo = toPolyline(series([0, 10, 20]), box);
    expect(geo.points[0].x).toBe(8); // padding
    expect(geo.points[2].x).toBe(312); // width - padding
    expect(geo.points[1].x).toBe(160); // centered
  });

  it("maps highest PnL to the top (small y) and lowest to the bottom", () => {
    const geo = toPolyline(series([0, 20, -20]), box);
    // padding..height-padding = 8..112
    const maxIdx = 1; // pnl 20 -> highest -> smallest y
    const minIdx = 2; // pnl -20 -> lowest -> largest y
    expect(geo.points[maxIdx].y).toBe(8);
    expect(geo.points[minIdx].y).toBe(112);
    expect(geo.min).toBe(-20);
    expect(geo.max).toBe(20);
  });

  it("centers a single point and pins it to the vertical middle (edge)", () => {
    const geo = toPolyline(series([42]), box);
    expect(geo.points).toHaveLength(1);
    expect(geo.points[0].x).toBe(8 + (320 - 16) / 2); // 160
    expect(geo.points[0].y).toBe(8 + (120 - 16) / 2); // 60 (center)
  });

  it("pins a flat series to the center line (no divide-by-zero, edge)", () => {
    const geo = toPolyline(series([5, 5, 5]), box);
    for (const p of geo.points) expect(p.y).toBe(60);
    expect(geo.min).toBe(5);
    expect(geo.max).toBe(5);
  });

  it("returns empty geometry for an empty series (edge)", () => {
    const geo = toPolyline([], box);
    expect(geo.points).toEqual([]);
    expect(geo.pointsAttr).toBe("");
    expect(geo.path).toBe("");
    expect(geo.areaPath).toBe("");
    // baseline falls back to the plot floor
    expect(geo.baselineY).toBe(112);
  });

  it("emits a points attr and an M/L path with the same coordinates", () => {
    const geo = toPolyline(series([0, 10]), box);
    expect(geo.pointsAttr).toBe("8,112 312,8");
    expect(geo.path).toBe("M 8 112 L 312 8");
  });

  it("closes the area path down to the plot floor for the fill", () => {
    const geo = toPolyline(series([0, 10]), box);
    // ...ends by dropping both ends to the floor (height - padding = 112) and Z
    expect(geo.areaPath.endsWith("L 312 112 L 8 112 Z")).toBe(true);
  });

  it("puts the zero-PnL baseline at the first sample's y", () => {
    const geo = toPolyline(series([0, 40, 80]), box);
    // pnl 0 is the min -> largest y (bottom)
    expect(geo.baselineY).toBe(112);
  });

  it("uses DEFAULT_VIEWBOX when none is given", () => {
    const geo = toPolyline(series([0, 1]));
    expect(geo.viewBox).toEqual(DEFAULT_VIEWBOX);
  });

  it("is deterministic across identical inputs", () => {
    const s = series([0, 3, -2, 7, 1]);
    expect(toPolyline(s, box)).toEqual(toPolyline(s, box));
  });
});

describe("formatting helpers", () => {
  it("formats signed USD PnL", () => {
    expect(formatPnl(157.05)).toBe("+$157.05");
    expect(formatPnl(-4.2)).toBe("-$4.20");
    expect(formatPnl(0)).toBe("$0.00");
    expect(formatPnl(12_480.2)).toBe("+$12,480.20");
  });

  it("formats signed percentages", () => {
    expect(formatReturnPct(0.16)).toBe("+0.16%");
    expect(formatReturnPct(-0.03)).toBe("-0.03%");
    expect(formatReturnPct(0)).toBe("0.00%");
  });
});
