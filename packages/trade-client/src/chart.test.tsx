import { act } from "@testing-library/react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  type Candle,
  CandleChart,
  type DepthBook,
  drawCandles,
  drawDepth,
  resolveChartColors,
} from "./chart";

/**
 * A recording mock of the CanvasRenderingContext2D surface the renderer uses.
 * Only the members the renderer touches are implemented; every drawing call is
 * counted so tests can assert the renderer issued the expected primitives.
 */
function createMockContext() {
  const calls = {
    fillRect: [] as number[][],
    strokeRect: [] as number[][],
    moveTo: [] as number[][],
    lineTo: [] as number[][],
    beginPath: 0,
    stroke: 0,
    fill: 0,
    clearRect: 0,
  };
  const ctx = {
    canvas: { width: 200, height: 100 },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    clearRect: () => {
      calls.clearRect += 1;
    },
    fillRect: (...a: number[]) => {
      calls.fillRect.push(a);
    },
    strokeRect: (...a: number[]) => {
      calls.strokeRect.push(a);
    },
    beginPath: () => {
      calls.beginPath += 1;
    },
    moveTo: (...a: number[]) => {
      calls.moveTo.push(a);
    },
    lineTo: (...a: number[]) => {
      calls.lineTo.push(a);
    },
    stroke: () => {
      calls.stroke += 1;
    },
    fill: () => {
      calls.fill += 1;
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const series: Candle[] = [
  { time: 1, open: 10, high: 14, low: 8, close: 12 },
  { time: 2, open: 12, high: 16, low: 11, close: 11 },
  { time: 3, open: 11, high: 13, low: 9, close: 13 },
];

describe("resolveChartColors", () => {
  it("falls back to defaults when CSS variables are absent", () => {
    const colors = resolveChartColors(undefined);
    expect(colors.buy).toBeTruthy();
    expect(colors.sell).toBeTruthy();
    expect(colors.grid).toBeTruthy();
  });

  it("reads --mvp-color-buy / --mvp-color-sell from a style source", () => {
    const source = {
      getPropertyValue: (name: string) =>
        name === "--mvp-color-buy"
          ? "#00ff00"
          : name === "--mvp-color-sell"
            ? "#ff0000"
            : "",
    };
    const colors = resolveChartColors(source);
    expect(colors.buy).toBe("#00ff00");
    expect(colors.sell).toBe("#ff0000");
  });
});

describe("drawCandles", () => {
  it("clears once and draws a body + wick per candle", () => {
    const { ctx, calls } = createMockContext();
    drawCandles(ctx, series, { width: 200, height: 100 });
    expect(calls.clearRect).toBe(1);
    // one filled body rect per candle
    expect(calls.fillRect.length).toBe(series.length);
    // one wick line (moveTo+lineTo) per candle
    expect(calls.moveTo.length).toBe(series.length);
    expect(calls.lineTo.length).toBe(series.length);
  });

  it("maps the highest high to the top (y≈0) and lowest low to the bottom", () => {
    const { ctx, calls } = createMockContext();
    drawCandles(ctx, series, { width: 200, height: 100, padding: 0 });
    // Wick top y for the candle containing the global high (16) should be ~0.
    const wickTops = calls.moveTo.map((a) => a[1]);
    expect(Math.min(...wickTops)).toBeCloseTo(0, 5);
    const wickBottoms = calls.lineTo.map((a) => a[1]);
    expect(Math.max(...wickBottoms)).toBeCloseTo(100, 5);
  });

  it("no-ops on an empty series (only clears)", () => {
    const { ctx, calls } = createMockContext();
    drawCandles(ctx, [], { width: 200, height: 100 });
    expect(calls.clearRect).toBe(1);
    expect(calls.fillRect.length).toBe(0);
  });
});

describe("drawDepth", () => {
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

  it("draws one filled area per side (bids + asks)", () => {
    const { ctx, calls } = createMockContext();
    drawDepth(ctx, book, { width: 200, height: 100 });
    expect(calls.clearRect).toBe(1);
    // two filled step areas (one per side)
    expect(calls.fill).toBe(2);
    expect(calls.beginPath).toBeGreaterThanOrEqual(2);
  });

  it("no-ops on an empty book (only clears)", () => {
    const { ctx, calls } = createMockContext();
    drawDepth(ctx, { bids: [], asks: [] }, { width: 200, height: 100 });
    expect(calls.clearRect).toBe(1);
    expect(calls.fill).toBe(0);
  });
});

describe("CandleChart", () => {
  it("renders a canvas element with the interval label", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => {
      root.render(createElement(CandleChart, { series, interval: "1m" }));
    });
    const canvas = el.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(
      el.querySelector("[data-interval]")?.getAttribute("data-interval"),
    ).toBe("1m");
    act(() => root.unmount());
    el.remove();
  });
});
