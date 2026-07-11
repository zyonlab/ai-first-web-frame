import type { FundingFrame, TickerFrame } from "@mvp/trade-data";
import { describe, expect, it } from "vitest";
import {
  computeCountdown,
  deriveVolume,
  formatVolume,
  toMarketHeaderView,
} from "./data";
import { type IslandState, initialIslandState, islandReducer } from "./island";
import type { MarketHeaderIslandProps } from "./render";

/** Builds a deterministic ticker frame for reducer/mapper tests. */
function ticker(overrides: Partial<TickerFrame> = {}): TickerFrame {
  return {
    channel: "ticker.mark",
    symbol: "BTC",
    seq: 5,
    ts: 5000,
    last: 63000.84,
    mark: 63003.35,
    change24h: 0.84,
    changePct24h: 0,
    ...overrides,
  };
}

function funding(overrides: Partial<FundingFrame> = {}): FundingFrame {
  return {
    channel: "funding.global",
    symbol: "BTC",
    seq: 1,
    ts: 1000,
    rate: 0,
    nextFundingTs: 28_800_000,
    intervalMs: 28_800_000,
    ...overrides,
  };
}

describe("toMarketHeaderView (ticker frame -> display model)", () => {
  it("maps a ticker + funding frame to a formatted, deterministic view", () => {
    const view = toMarketHeaderView(ticker(), funding());
    expect(view).toMatchObject({
      symbol: "BTC",
      mark: "63,003.35",
      oracle: "63,000.84",
      changePct24h: "0.00%",
      direction: "flat",
      funding: "0.0000%",
      nextFundingTs: 28_800_000,
      fundingIntervalMs: 28_800_000,
    });
  });

  it("flags a positive move as `up` and a negative move as `down`", () => {
    const up = toMarketHeaderView(ticker({ changePct24h: 0.0124 }), funding());
    expect(up.direction).toBe("up");
    expect(up.changePct24h).toBe("+1.24%");

    const down = toMarketHeaderView(
      ticker({ changePct24h: -0.0058 }),
      funding(),
    );
    expect(down.direction).toBe("down");
    expect(down.changePct24h).toBe("-0.58%");
  });

  it("formats funding as a signed 4-decimal percent", () => {
    const view = toMarketHeaderView(ticker(), funding({ rate: 0.000101 }));
    expect(view.funding).toBe("+0.0101%");
  });

  it("derives a stable 24h volume purely from the frame", () => {
    const a = deriveVolume(ticker());
    const b = deriveVolume(ticker());
    expect(a).toBe(b);
    expect(formatVolume(a)).toMatch(/^\d+\.\d{2}B$/);
  });
});

describe("computeCountdown (given now)", () => {
  it("returns HH:MM:SS remaining to the next funding settlement", () => {
    expect(computeCountdown(28_800_000, 0)).toEqual({
      remainingMs: 28_800_000,
      label: "08:00:00",
    });
  });

  it("counts down deterministically as `now` advances", () => {
    expect(computeCountdown(28_800_000, 28_800_000 - 65_000).label).toBe(
      "00:01:05",
    );
  });

  it("clamps to zero once the settlement time has passed", () => {
    expect(computeCountdown(1000, 5000)).toEqual({
      remainingMs: 0,
      label: "00:00:00",
    });
  });
});

describe("islandReducer (new ticker frame -> display model)", () => {
  const props: MarketHeaderIslandProps = {
    view: toMarketHeaderView(ticker(), funding()),
    seededNowMs: 0,
    countdownLabel: "08:00:00",
  };
  const initial: IslandState = initialIslandState(props);

  it("resumes from the SSR snapshot props unchanged", () => {
    expect(initial.view.mark).toBe("63,003.35");
    expect(initial.countdownLabel).toBe("08:00:00");
  });

  it("patches the view from a new ticker frame (deterministic)", () => {
    const next = islandReducer(initial, {
      type: "ticker",
      ticker: ticker({ mark: 63_500, last: 63_480, changePct24h: 0.0124 }),
      funding: funding(),
    });
    expect(next.view.mark).toBe("63,500.00");
    expect(next.view.oracle).toBe("63,480.00");
    expect(next.view.direction).toBe("up");
    expect(next.view.changePct24h).toBe("+1.24%");
    // Untouched countdown seed is preserved.
    expect(next.countdownLabel).toBe("08:00:00");
  });

  it("recomputes only the countdown label on a `tick`", () => {
    const ticked = islandReducer(initial, {
      type: "tick",
      nowMs: 28_800_000 - 3_600_000,
    });
    expect(ticked.countdownLabel).toBe("01:00:00");
    // View is untouched (referential no-op path is fine; value is unchanged).
    expect(ticked.view.mark).toBe("63,003.35");
  });

  it("returns the same state when a tick does not change the label", () => {
    const same = islandReducer(initial, { type: "tick", nowMs: 0 });
    expect(same).toBe(initial);
  });

  it("replaces the whole view on a symbol switch", () => {
    const swapped = islandReducer(initial, {
      type: "symbol",
      view: toMarketHeaderView(
        ticker({
          symbol: "ETH",
          mark: 3101.01,
          last: 3101.02,
          changePct24h: 0.0003,
        }),
        funding({ symbol: "ETH" }),
      ),
      seededNowMs: 0,
    });
    expect(swapped.view.symbol).toBe("ETH");
    expect(swapped.view.mark).toBe("3,101.01");
    expect(swapped.view.direction).toBe("up");
    expect(swapped.countdownLabel).toBe("08:00:00");
  });
});
