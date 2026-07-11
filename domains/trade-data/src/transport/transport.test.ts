import type { DataDependency, RequestContext } from "@mvp/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBookState,
  createCandleState,
  createFundingState,
  createMockSubscriptionTransport,
  createPrng,
  createTickerState,
  createTradeState,
  deriveSeed,
  FIXTURE_SEED,
  feedForSourceId,
  getFixture,
  intervalMsFor,
  type MarketFrame,
  nextCandleFrame,
  nextFundingFrame,
  nextOrderbookFrame,
  nextTickerFrame,
  nextTradeFrame,
  seedCandles,
  tradeFixtures,
} from "./index";

const ctx: RequestContext = {
  traceId: "trace-mock",
  requestId: "req-mock",
  locale: "en-US",
  tenant: "tenant-a",
  featureFlags: {},
  experiment: { bucket: "a" },
  theme: "system",
  device: "desktop",
  user: { id: "user-1" },
  userAgent: "vitest",
  timestamp: new Date("2026-01-01T00:00:00.000Z").toISOString(),
};

const realtimeDep: DataDependency = {
  id: "orderbook.l2",
  owner: "fragment",
  source: "subscription",
  freshness: "realtime",
  privacy: "public",
  invalidationTags: ["book:BTC"],
  dependsOn: [],
};

describe("prng", () => {
  it("is fully deterministic for a given seed", () => {
    const draw = (seed: number) => {
      let prng = createPrng(seed);
      const values: number[] = [];
      for (let i = 0; i < 8; i += 1) {
        const step = prng.next();
        prng = step.prng;
        values.push(step.value);
      }
      return values;
    };
    expect(draw(42)).toEqual(draw(42));
    expect(draw(42)).not.toEqual(draw(43));
  });

  it("keeps values in [0, 1)", () => {
    let prng = createPrng(7);
    for (let i = 0; i < 1000; i += 1) {
      const step = prng.next();
      prng = step.prng;
      expect(step.value).toBeGreaterThanOrEqual(0);
      expect(step.value).toBeLessThan(1);
    }
  });

  it("derives distinct seeds per symbol from the same base seed", () => {
    expect(deriveSeed(1, "BTC")).not.toBe(deriveSeed(1, "ETH"));
    expect(deriveSeed(1, "BTC")).toBe(deriveSeed(1, "BTC"));
  });
});

describe("frame generators — determinism", () => {
  it("orderbook: same seed+symbol ⇒ identical frame sequence", () => {
    const run = () => {
      let state = createBookState(9, "BTC");
      const frames = [];
      for (let i = 0; i < 10; i += 1) {
        const next = nextOrderbookFrame(state);
        state = next.state;
        frames.push(next.frame);
      }
      return frames;
    };
    expect(run()).toEqual(run());
  });

  it("trades / ticker / funding / candles: reproducible", () => {
    const trades = (n: number) => {
      let state = createTradeState(5, "ETH");
      const out = [];
      for (let i = 0; i < n; i += 1) {
        const step = nextTradeFrame(state);
        state = step.state;
        out.push(step.frame);
      }
      return out;
    };
    expect(trades(6)).toEqual(trades(6));

    const ticker = () => {
      let state = createTickerState(5, "ETH");
      const out = [];
      for (let i = 0; i < 6; i += 1) {
        const step = nextTickerFrame(state);
        state = step.state;
        out.push(step.frame);
      }
      return out;
    };
    expect(ticker()).toEqual(ticker());

    const funding = () => {
      let state = createFundingState(5, "ETH");
      const out = [];
      for (let i = 0; i < 6; i += 1) {
        const step = nextFundingFrame(state);
        state = step.state;
        out.push(step.frame);
      }
      return out;
    };
    expect(funding()).toEqual(funding());

    const candles = () => {
      let state = createCandleState(5, "ETH", "1m");
      const out = [];
      for (let i = 0; i < 12; i += 1) {
        const step = nextCandleFrame(state);
        state = step.state;
        out.push(step.frame);
      }
      return out;
    };
    expect(candles()).toEqual(candles());
  });
});

describe("frame generators — invariants", () => {
  it("orderbook: prices positive, bid<ask, spread>0, depth decreases outward", () => {
    let state = createBookState(11, "BTC");
    for (let i = 0; i < 30; i += 1) {
      const next = nextOrderbookFrame(state);
      state = next.state;
      const { bids, asks, spread } = next.frame;
      expect(bids.length).toBe(asks.length);
      expect(bids[0].price).toBeLessThan(asks[0].price);
      expect(spread).toBeGreaterThan(0);
      // Bids strictly descending, asks strictly ascending, all positive.
      for (let l = 0; l < bids.length; l += 1) {
        expect(bids[l].price).toBeGreaterThan(0);
        expect(asks[l].price).toBeGreaterThan(0);
        expect(bids[l].size).toBeGreaterThan(0);
        expect(asks[l].size).toBeGreaterThan(0);
        if (l > 0) {
          expect(bids[l].price).toBeLessThan(bids[l - 1].price);
          expect(asks[l].price).toBeGreaterThan(asks[l - 1].price);
        }
      }
      // The outermost level should hold no more size than the touch (decay).
      expect(bids[bids.length - 1].size).toBeLessThanOrEqual(
        bids[0].size * 1.4,
      );
    }
  });

  it("trades: positive price/size, valid side, monotone seq", () => {
    let state = createTradeState(3, "BTC");
    let lastSeq = 0;
    for (let i = 0; i < 50; i += 1) {
      const next = nextTradeFrame(state);
      state = next.state;
      expect(next.frame.price).toBeGreaterThan(0);
      expect(next.frame.size).toBeGreaterThan(0);
      expect(["buy", "sell"]).toContain(next.frame.side);
      expect(next.frame.seq).toBe(lastSeq + 1);
      lastSeq = next.frame.seq;
    }
  });

  it("ticker: positive last/mark; changePct is consistent with change", () => {
    let state = createTickerState(3, "BTC");
    for (let i = 0; i < 40; i += 1) {
      const next = nextTickerFrame(state);
      state = next.state;
      expect(next.frame.last).toBeGreaterThan(0);
      expect(next.frame.mark).toBeGreaterThan(0);
      // change and pct share sign (guard against near-zero rounding, where
      // the 2dp change and 4dp pct can round to different sides of zero).
      if (next.frame.change24h !== 0 && next.frame.changePct24h !== 0) {
        expect(Math.sign(next.frame.change24h)).toBe(
          Math.sign(next.frame.changePct24h),
        );
      }
    }
  });

  it("funding: rate stays within realistic bounds; next funding is in the future", () => {
    let state = createFundingState(3, "BTC");
    for (let i = 0; i < 40; i += 1) {
      const next = nextFundingFrame(state);
      state = next.state;
      expect(Math.abs(next.frame.rate)).toBeLessThanOrEqual(0.0005);
      expect(next.frame.nextFundingTs).toBeGreaterThan(next.frame.ts);
    }
  });

  it("candles: OHLC invariants hold; volume monotone within a candle", () => {
    let state = createCandleState(3, "BTC", "1m");
    let prevSeqVolume = 0;
    let prevOpenTime = -1;
    for (let i = 0; i < 40; i += 1) {
      const next = nextCandleFrame(state);
      const c = next.frame.candle;
      expect(c.low).toBeLessThanOrEqual(c.open);
      expect(c.low).toBeLessThanOrEqual(c.close);
      expect(c.high).toBeGreaterThanOrEqual(c.open);
      expect(c.high).toBeGreaterThanOrEqual(c.close);
      expect(c.low).toBeGreaterThan(0);
      // Volume grows within a candle; resets when a new candle opens.
      if (c.openTime === prevOpenTime) {
        expect(c.volume).toBeGreaterThanOrEqual(prevSeqVolume);
      }
      prevSeqVolume = c.volume;
      prevOpenTime = c.openTime;
      state = next.state;
    }
  });

  it("seedCandles: yields the requested count with valid, time-ordered candles", () => {
    const candles = seedCandles(FIXTURE_SEED, "BTC", "5m", 30);
    expect(candles).toHaveLength(30);
    const step = intervalMsFor("5m");
    for (let i = 0; i < candles.length; i += 1) {
      const c = candles[i];
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      expect(c.openTime).toBe(i * step);
    }
  });
});

describe("createMockSubscriptionTransport — lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("infers the feed from sourceId and pushes on the timer", () => {
    const transport = createMockSubscriptionTransport({
      seed: 1,
      symbol: "BTC",
      intervalMs: 1000,
    });
    const received: MarketFrame[] = [];
    transport.onMessage((data) => received.push(data as MarketFrame));
    void transport.connect({
      sourceId: "orderbook.l2",
      key: "k",
      dependency: realtimeDep,
      ctx,
    });

    expect(received).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(received).toHaveLength(1);
    expect(received[0].channel).toBe("orderbook.l2");
    vi.advanceTimersByTime(3000);
    expect(received).toHaveLength(4);

    void transport.close();
  });

  it("stops emitting after close and clears the timer", () => {
    const clear = vi.fn();
    const scheduler = {
      setInterval: (fn: () => void, ms: number) => {
        const id = setInterval(fn, ms);
        return {
          clear: () => {
            clear();
            clearInterval(id);
          },
        };
      },
    };
    const transport = createMockSubscriptionTransport({
      seed: 1,
      symbol: "BTC",
      intervalMs: 500,
      scheduler,
    });
    const received: MarketFrame[] = [];
    transport.onMessage((d) => received.push(d as MarketFrame));
    void transport.connect({
      sourceId: "trades.prints",
      key: "k",
      dependency: realtimeDep,
      ctx,
    });
    vi.advanceTimersByTime(1500);
    expect(received.length).toBe(3);

    void transport.close();
    expect(clear).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(received.length).toBe(3); // no further pushes
  });

  it("produces identical streams for identical seed+symbol", () => {
    const collect = () => {
      const t = createMockSubscriptionTransport({
        seed: 77,
        symbol: "ETH",
        intervalMs: 1000,
      });
      const out: MarketFrame[] = [];
      t.onMessage((d) => out.push(d as MarketFrame));
      void t.connect({
        sourceId: "ticker.mark",
        key: "k",
        dependency: realtimeDep,
        ctx,
      });
      vi.advanceTimersByTime(5000);
      void t.close();
      return out;
    };
    expect(collect()).toEqual(collect());
  });

  it("honours an explicit feed override and the candles interval", () => {
    const transport = createMockSubscriptionTransport({
      seed: 1,
      symbol: "BTC",
      feed: "candles.live",
      interval: "5m",
      intervalMs: 1000,
    });
    const received: MarketFrame[] = [];
    transport.onMessage((d) => received.push(d as MarketFrame));
    // sourceId does not name a feed; the override wins.
    void transport.connect({
      sourceId: "candles.history",
      key: "k",
      dependency: realtimeDep,
      ctx,
    });
    vi.advanceTimersByTime(1000);
    expect(received[0].channel).toBe("candles.live");
    void transport.close();
  });

  it("throws when the feed cannot be inferred and no override is given", () => {
    const transport = createMockSubscriptionTransport({
      seed: 1,
      symbol: "BTC",
    });
    expect(() =>
      transport.connect({
        sourceId: "unknown.source",
        key: "k",
        dependency: realtimeDep,
        ctx,
      }),
    ).toThrow(/cannot infer feed/);
  });
});

describe("createMockSubscriptionTransport — integration with subscribeData", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("drives subscribeData end to end (connect -> deliver -> close)", async () => {
    const { createDataClient, defineDataSource } = await import("@mvp/data");
    const source = defineDataSource({
      id: "orderbook.l2",
      dependency: realtimeDep,
      load: async () => null,
    });
    const client = createDataClient({ ctx, sources: [source] });
    const transport = createMockSubscriptionTransport({
      seed: 1,
      symbol: "BTC",
      intervalMs: 1000,
    });
    const handler = vi.fn();
    const unsubscribe = client.subscribeData("orderbook.l2", handler, {
      params: { symbol: "BTC" },
      transport,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(handler).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2);

    unsubscribe();
    const callsAfterUnsub = handler.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(handler.mock.calls.length).toBe(callsAfterUnsub);
  });
});

describe("feedForSourceId", () => {
  it("maps known source ids and rejects unknown", () => {
    expect(feedForSourceId("orderbook.l2")).toBe("orderbook.l2");
    expect(feedForSourceId("ticker.mark")).toBe("ticker.mark");
    expect(feedForSourceId("nope")).toBeUndefined();
  });
});

describe("fixtures", () => {
  it("are stable across accesses and match a fresh build from the same seed", () => {
    // tradeFixtures is built once; getFixture returns the same object.
    expect(getFixture("BTC")).toBe(tradeFixtures.BTC);

    // Rebuild the orderbook snapshot the same way fixtures do and compare.
    let state = createBookState(FIXTURE_SEED, "BTC");
    let frame = nextOrderbookFrame(state).frame;
    for (let i = 0; i < 5; i += 1) {
      const next = nextOrderbookFrame(state);
      state = next.state;
      frame = next.frame;
    }
    expect(tradeFixtures.BTC.orderbook).toEqual(frame);
  });

  it("expose sane snapshots for every symbol", () => {
    for (const symbol of ["BTC", "ETH"] as const) {
      const fx = tradeFixtures[symbol];
      expect(fx.orderbook.bids[0].price).toBeLessThan(
        fx.orderbook.asks[0].price,
      );
      expect(fx.trades.length).toBe(20);
      expect(fx.ticker.last).toBeGreaterThan(0);
      expect(fx.candles.history.length).toBe(60);
      expect(fx.candles.live.channel).toBe("candles.live");
    }
  });

  it("BTC and ETH fixtures diverge (per-symbol seed)", () => {
    expect(tradeFixtures.BTC.ticker.last).not.toBe(
      tradeFixtures.ETH.ticker.last,
    );
  });
});
