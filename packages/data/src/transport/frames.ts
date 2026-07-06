/**
 * Pure, deterministic frame generators for the mock market-data transport.
 *
 * Each generator is a pure function `(state) -> { state, frame }`: it takes an
 * immutable generator state (which carries the seeded PRNG plus the running
 * market values) and returns the next state together with the emitted frame.
 * There are no side effects, no wall-clock reads, and no `Math.random` — given
 * the same seed + symbol the frame sequence is byte-identical.
 *
 * Frame shapes mirror the data sources in
 * `docs/trade-demo/03-data-architecture.md` §1 (orderbook.l2, trades.prints,
 * ticker.mark, funding.global, candles.history/candles.live). All values are
 * financially sane: prices are positive, `bid < ask`, depth decreases away from
 * the touch, and candles satisfy `low <= open/close <= high`.
 */

import {
  createPrng,
  deriveSeed,
  gaussian,
  intBetween,
  type Prng,
  uniform,
} from "./prng";

// ---------------------------------------------------------------------------
// Frame shapes (aligned with 03-data-architecture.md §1)
// ---------------------------------------------------------------------------

/** A single price level in an order book ladder. */
export type BookLevel = {
  /** Price of the level (positive). */
  price: number;
  /** Resting size at this level (positive). */
  size: number;
};

/** `orderbook.l2` frame: bid/ask ladders + derived spread. */
export type OrderbookL2Frame = {
  channel: "orderbook.l2";
  symbol: string;
  /** Monotonically increasing per-stream sequence number. */
  seq: number;
  /** Logical timestamp (ms) derived from tick index — NOT wall clock. */
  ts: number;
  /** Best-to-worst bids (descending price). */
  bids: BookLevel[];
  /** Best-to-worst asks (ascending price). */
  asks: BookLevel[];
  /** Best ask − best bid. */
  spread: number;
};

/** `trades.prints` frame: a single executed print. */
export type TradePrintFrame = {
  channel: "trades.prints";
  symbol: string;
  seq: number;
  ts: number;
  /** Aggressor side. */
  side: "buy" | "sell";
  price: number;
  size: number;
};

/** `ticker.mark` frame: mark/last + rolling 24h change. */
export type TickerFrame = {
  channel: "ticker.mark";
  symbol: string;
  seq: number;
  ts: number;
  last: number;
  /** Mark price (index-anchored; tracks `last` closely). */
  mark: number;
  /** Absolute 24h change in quote currency. */
  change24h: number;
  /** 24h change as a ratio (e.g. 0.0123 = +1.23%). */
  changePct24h: number;
};

/** `funding.global` frame: current funding rate + next-funding countdown. */
export type FundingFrame = {
  channel: "funding.global";
  symbol: string;
  seq: number;
  ts: number;
  /** Funding rate for the current interval (e.g. 0.0001 = 1 bps). */
  rate: number;
  /** Logical timestamp (ms) of the next funding settlement. */
  nextFundingTs: number;
  /** Funding interval length in ms (fixed at 8h). */
  intervalMs: number;
};

/** A single OHLCV candle. */
export type Candle = {
  /** Candle open time (ms). */
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/**
 * `candles.live` frame: the current (possibly still-forming) candle plus a flag
 * indicating whether it just closed. History bootstrap uses {@link seedCandles}.
 */
export type CandleFrame = {
  channel: "candles.live";
  symbol: string;
  interval: string;
  seq: number;
  ts: number;
  candle: Candle;
  /** True on the tick where a candle closed and a new one opened. */
  closed: boolean;
};

/** Union of every frame the mock transport can emit. */
export type MarketFrame =
  | OrderbookL2Frame
  | TradePrintFrame
  | TickerFrame
  | FundingFrame
  | CandleFrame;

// ---------------------------------------------------------------------------
// Base prices — deterministic per symbol so BTC/ETH look distinct
// ---------------------------------------------------------------------------

const SYMBOL_BASE_PRICE: Record<string, number> = {
  BTC: 63_000,
  ETH: 3_100,
  SOL: 145,
};

/** Base price for a symbol; unknown symbols get a stable seeded default. */
export function basePriceFor(symbol: string): number {
  const known = SYMBOL_BASE_PRICE[symbol.toUpperCase()];
  if (known !== undefined) return known;
  // Deterministic fallback in a sane range for unknown symbols.
  const { value } = uniform(createPrng(deriveSeed(1, symbol)), 5, 500);
  return Math.round(value * 100) / 100;
}

const LOGICAL_TICK_MS = 1_000;
const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1_000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

// ---------------------------------------------------------------------------
// Order book generator
// ---------------------------------------------------------------------------

export type BookGenState = {
  prng: Prng;
  symbol: string;
  /** Number of levels per side. */
  depth: number;
  /** Mid price, walked each tick. */
  mid: number;
  /** Absolute price step between adjacent levels. */
  tick: number;
  seq: number;
};

/** Creates a deterministic order-book generator state. */
export function createBookState(
  seed: number,
  symbol: string,
  options: { depth?: number } = {},
): BookGenState {
  const mid = basePriceFor(symbol);
  return {
    prng: createPrng(deriveSeed(seed, `${symbol}:book`)),
    symbol,
    depth: options.depth ?? 12,
    mid,
    // Tick ~1bp of price, at least 0.01.
    tick: Math.max(0.01, round2(mid * 0.0001)),
    seq: 0,
  };
}

/**
 * Advances the book one tick. The mid does a small gaussian walk; each level is
 * `tick`-spaced from the touch with sizes that decrease away from the touch
 * plus a bounded seeded jitter. Invariants: all prices > 0, `bid < ask`, sizes
 * strictly positive, size roughly monotone-decreasing outward.
 */
export function nextOrderbookFrame(state: BookGenState): {
  state: BookGenState;
  frame: OrderbookL2Frame;
} {
  const walk = gaussian(state.prng);
  const nextMid = Math.max(
    state.tick * (state.depth + 2),
    state.mid + walk.value * state.tick,
  );

  const bids: BookLevel[] = [];
  const asks: BookLevel[] = [];
  let prng = walk.prng;

  const halfSpread = state.tick / 2;
  const baseSize = Math.max(0.1, round2(1_000_000 / nextMid));

  for (let level = 0; level < state.depth; level += 1) {
    const bidPrice = round2(nextMid - halfSpread - level * state.tick);
    const askPrice = round2(nextMid + halfSpread + level * state.tick);
    // Depth decays outward; jitter stays within +/-15% so it never re-orders.
    const decay = 1 - level / (state.depth * 1.5);
    const bidJ = uniform(prng, 0.85, 1.15);
    prng = bidJ.prng;
    const askJ = uniform(prng, 0.85, 1.15);
    prng = askJ.prng;
    bids.push({
      price: bidPrice,
      size: round4(Math.max(0.0001, baseSize * decay * bidJ.value)),
    });
    asks.push({
      price: askPrice,
      size: round4(Math.max(0.0001, baseSize * decay * askJ.value)),
    });
  }

  const seq = state.seq + 1;
  const frame: OrderbookL2Frame = {
    channel: "orderbook.l2",
    symbol: state.symbol,
    seq,
    ts: seq * LOGICAL_TICK_MS,
    bids,
    asks,
    spread: round2(asks[0].price - bids[0].price),
  };
  return { state: { ...state, prng, mid: nextMid, seq }, frame };
}

// ---------------------------------------------------------------------------
// Trades generator
// ---------------------------------------------------------------------------

export type TradeGenState = {
  prng: Prng;
  symbol: string;
  last: number;
  tick: number;
  seq: number;
};

export function createTradeState(seed: number, symbol: string): TradeGenState {
  const last = basePriceFor(symbol);
  return {
    prng: createPrng(deriveSeed(seed, `${symbol}:trades`)),
    symbol,
    last,
    tick: Math.max(0.01, round2(last * 0.0001)),
    seq: 0,
  };
}

/**
 * Emits a single print. Side is a seeded coin flip; the print price steps a few
 * ticks in the aggressor's direction; size is a seeded positive draw.
 */
export function nextTradeFrame(state: TradeGenState): {
  state: TradeGenState;
  frame: TradePrintFrame;
} {
  const sideDraw = state.prng.next();
  const side: "buy" | "sell" = sideDraw.value < 0.5 ? "sell" : "buy";
  const stepDraw = intBetween(sideDraw.prng, 0, 3);
  const direction = side === "buy" ? 1 : -1;
  const price = Math.max(
    state.tick,
    round2(state.last + direction * stepDraw.value * state.tick),
  );
  const sizeDraw = uniform(stepDraw.prng, 0.001, 2.5);
  const size = round4(
    Math.max(0.0001, sizeDraw.value * (1_000 / price + 0.01)),
  );

  const seq = state.seq + 1;
  const frame: TradePrintFrame = {
    channel: "trades.prints",
    symbol: state.symbol,
    seq,
    ts: seq * LOGICAL_TICK_MS,
    side,
    price,
    size,
  };
  return { state: { ...state, prng: sizeDraw.prng, last: price, seq }, frame };
}

// ---------------------------------------------------------------------------
// Ticker / mark generator (random walk)
// ---------------------------------------------------------------------------

export type TickerGenState = {
  prng: Prng;
  symbol: string;
  /** Reference price 24h ago, fixed at construction for change math. */
  open24h: number;
  last: number;
  tick: number;
  seq: number;
};

export function createTickerState(
  seed: number,
  symbol: string,
): TickerGenState {
  const last = basePriceFor(symbol);
  return {
    prng: createPrng(deriveSeed(seed, `${symbol}:ticker`)),
    symbol,
    open24h: last,
    last,
    tick: Math.max(0.01, round2(last * 0.0001)),
    seq: 0,
  };
}

/**
 * Advances mark/last by a small gaussian random walk (clamped positive) and
 * recomputes 24h change against the fixed reference. `mark` tracks `last` with a
 * tiny deterministic offset so the two are correlated but not identical.
 */
export function nextTickerFrame(state: TickerGenState): {
  state: TickerGenState;
  frame: TickerFrame;
} {
  const walk = gaussian(state.prng);
  const last = Math.max(
    state.tick,
    round2(state.last + walk.value * state.tick * 3),
  );
  const markOffset = uniform(walk.prng, -0.5, 0.5);
  const mark = Math.max(
    state.tick,
    round2(last + markOffset.value * state.tick),
  );
  const change24h = round2(last - state.open24h);
  const changePct24h = round4((last - state.open24h) / state.open24h);

  const seq = state.seq + 1;
  const frame: TickerFrame = {
    channel: "ticker.mark",
    symbol: state.symbol,
    seq,
    ts: seq * LOGICAL_TICK_MS,
    last,
    mark,
    change24h,
    changePct24h,
  };
  return { state: { ...state, prng: markOffset.prng, last, seq }, frame };
}

// ---------------------------------------------------------------------------
// Funding generator
// ---------------------------------------------------------------------------

export type FundingGenState = {
  prng: Prng;
  symbol: string;
  rate: number;
  seq: number;
};

export function createFundingState(
  seed: number,
  symbol: string,
): FundingGenState {
  const seeded = uniform(
    createPrng(deriveSeed(seed, `${symbol}:funding`)),
    -0.0002,
    0.0002,
  );
  return {
    prng: seeded.prng,
    symbol,
    rate: round4(seeded.value),
    seq: 0,
  };
}

/**
 * Advances the funding rate with a small mean-reverting jitter (kept within a
 * realistic +/-0.05%/interval band) and recomputes the next-settlement time as
 * the next 8h boundary from the logical clock.
 */
export function nextFundingFrame(state: FundingGenState): {
  state: FundingGenState;
  frame: FundingFrame;
} {
  const jitter = uniform(state.prng, -0.00002, 0.00002);
  // Mean-revert toward 0 so the rate does not drift unbounded.
  const rate = round4(
    Math.max(-0.0005, Math.min(0.0005, state.rate * 0.98 + jitter.value)),
  );
  const seq = state.seq + 1;
  const ts = seq * LOGICAL_TICK_MS;
  const nextFundingTs =
    Math.ceil((ts + 1) / FUNDING_INTERVAL_MS) * FUNDING_INTERVAL_MS;
  const frame: FundingFrame = {
    channel: "funding.global",
    symbol: state.symbol,
    seq,
    ts,
    rate,
    nextFundingTs,
    intervalMs: FUNDING_INTERVAL_MS,
  };
  return { state: { ...state, prng: jitter.prng, rate, seq }, frame };
}

// ---------------------------------------------------------------------------
// Candle generator (OHLCV history + incremental live candle)
// ---------------------------------------------------------------------------

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

/** Interval length in ms; unknown intervals default to 1m. */
export function intervalMsFor(interval: string): number {
  return INTERVAL_MS[interval] ?? 60_000;
}

export type CandleGenState = {
  prng: Prng;
  symbol: string;
  interval: string;
  /** The candle currently forming. */
  current: Candle;
  /** How many live ticks have folded into `current` so far. */
  ticksInCandle: number;
  /** Ticks per candle before it closes. */
  ticksPerCandle: number;
  seq: number;
};

/**
 * Generates a deterministic OHLCV history of `count` candles ending at the
 * candle immediately before "now". Used to seed the chart's first paint.
 */
export function seedCandles(
  seed: number,
  symbol: string,
  interval: string,
  count: number,
): Candle[] {
  const step = intervalMsFor(interval);
  let prng = createPrng(deriveSeed(seed, `${symbol}:candles:${interval}`));
  let close = basePriceFor(symbol);
  const tick = Math.max(0.01, round2(close * 0.0001));
  const candles: Candle[] = [];
  for (let i = 0; i < count; i += 1) {
    const open = close;
    const drift = gaussian(prng);
    prng = drift.prng;
    const move = drift.value * tick * 5;
    close = Math.max(tick, round2(open + move));
    const wick = uniform(prng, 0, tick * 4);
    prng = wick.prng;
    const high = round2(Math.max(open, close) + wick.value);
    const low = round2(Math.max(tick, Math.min(open, close) - wick.value));
    const vol = uniform(prng, 5, 50);
    prng = vol.prng;
    candles.push({
      openTime: i * step,
      open,
      high,
      low,
      close,
      volume: round4(vol.value),
    });
  }
  return candles;
}

/** Builds a live-candle generator whose first tick continues from the seeded history. */
export function createCandleState(
  seed: number,
  symbol: string,
  interval: string,
  options: { ticksPerCandle?: number } = {},
): CandleGenState {
  const step = intervalMsFor(interval);
  const history = seedCandles(seed, symbol, interval, 1);
  const seedClose = history[0].close;
  const openTime = step; // first live candle opens right after the single seed candle
  return {
    // Continue the same stream the history used so live values follow smoothly.
    prng: createPrng(deriveSeed(seed, `${symbol}:candles:${interval}:live`)),
    symbol,
    interval,
    current: {
      openTime,
      open: seedClose,
      high: seedClose,
      low: seedClose,
      close: seedClose,
      volume: 0,
    },
    ticksInCandle: 0,
    ticksPerCandle: options.ticksPerCandle ?? 5,
    seq: 0,
  };
}

/**
 * Advances the live candle one tick: folds a new gaussian price move into the
 * forming candle's close/high/low/volume. When `ticksPerCandle` is reached the
 * candle closes (`closed: true`) and a fresh candle opens at the prior close.
 * Invariants preserved: `low <= open,close <= high`, volume monotone within a
 * candle, prices positive.
 */
export function nextCandleFrame(state: CandleGenState): {
  state: CandleGenState;
  frame: CandleFrame;
} {
  const step = intervalMsFor(state.interval);
  const tick = Math.max(0.01, round2(state.current.open * 0.0001));
  const move = gaussian(state.prng);
  const volDraw = uniform(move.prng, 0.5, 5);
  const nextClose = Math.max(
    tick,
    round2(state.current.close + move.value * tick * 3),
  );

  const current: Candle = {
    ...state.current,
    close: nextClose,
    high: round2(Math.max(state.current.high, nextClose)),
    low: round2(Math.min(state.current.low, nextClose)),
    volume: round4(state.current.volume + volDraw.value),
  };

  const ticksInCandle = state.ticksInCandle + 1;
  const willClose = ticksInCandle >= state.ticksPerCandle;

  let nextState: CandleGenState;
  if (willClose) {
    const openTime = current.openTime + step;
    nextState = {
      ...state,
      prng: volDraw.prng,
      current: {
        openTime,
        open: nextClose,
        high: nextClose,
        low: nextClose,
        close: nextClose,
        volume: 0,
      },
      ticksInCandle: 0,
      seq: state.seq + 1,
    };
  } else {
    nextState = {
      ...state,
      prng: volDraw.prng,
      current,
      ticksInCandle,
      seq: state.seq + 1,
    };
  }

  const seq = state.seq + 1;
  const frame: CandleFrame = {
    channel: "candles.live",
    symbol: state.symbol,
    interval: state.interval,
    seq,
    ts: seq * LOGICAL_TICK_MS,
    candle: current,
    closed: willClose,
  };
  return { state: nextState, frame };
}
