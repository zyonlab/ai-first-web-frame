/**
 * Deterministic fixture snapshots derived from the seeded generators.
 *
 * These are stable, JSON-serializable values other agents can reuse as:
 * - SSR first-paint initial state (the snapshot the island's reducer resumes
 *   from — see 03-data-architecture.md §2 "snapshot -> patch seam"), and
 * - golden values in tests (assert a fragment renders the fixture ladder/tape).
 *
 * Every fixture is produced with a FIXED seed so it never changes across runs.
 * Regenerating with the same seed yields byte-identical output. To add a new
 * snapshot, extend the maps below — do not hardcode literals by hand.
 */

import {
  type Candle,
  type CandleFrame,
  createBookState,
  createCandleState,
  createFundingState,
  createTickerState,
  createTradeState,
  type FundingFrame,
  nextCandleFrame,
  nextFundingFrame,
  nextOrderbookFrame,
  nextTickerFrame,
  nextTradeFrame,
  type OrderbookL2Frame,
  seedCandles,
  type TickerFrame,
  type TradePrintFrame,
} from "./frames";

/** The seed all fixtures are built from. Do not change without regenerating. */
export const FIXTURE_SEED = 1337;

/** Symbols with baked snapshots. */
export const FIXTURE_SYMBOLS = ["BTC", "ETH"] as const;
export type FixtureSymbol = (typeof FIXTURE_SYMBOLS)[number];

function orderbookSnapshot(symbol: string): OrderbookL2Frame {
  // Warm the generator a few ticks so the ladder is settled, then snapshot.
  let state = createBookState(FIXTURE_SEED, symbol);
  let frame = nextOrderbookFrame(state).frame;
  for (let i = 0; i < 5; i += 1) {
    const next = nextOrderbookFrame(state);
    state = next.state;
    frame = next.frame;
  }
  return frame;
}

function tradesSnapshot(symbol: string, count: number): TradePrintFrame[] {
  let state = createTradeState(FIXTURE_SEED, symbol);
  const prints: TradePrintFrame[] = [];
  for (let i = 0; i < count; i += 1) {
    const next = nextTradeFrame(state);
    state = next.state;
    prints.push(next.frame);
  }
  return prints;
}

function tickerSnapshot(symbol: string): TickerFrame {
  let state = createTickerState(FIXTURE_SEED, symbol);
  let frame = nextTickerFrame(state).frame;
  for (let i = 0; i < 5; i += 1) {
    const next = nextTickerFrame(state);
    state = next.state;
    frame = next.frame;
  }
  return frame;
}

function fundingSnapshot(symbol: string): FundingFrame {
  const state = createFundingState(FIXTURE_SEED, symbol);
  return nextFundingFrame(state).frame;
}

function candlesSnapshot(
  symbol: string,
  interval: string,
  count: number,
): { history: Candle[]; live: CandleFrame } {
  const history = seedCandles(FIXTURE_SEED, symbol, interval, count);
  const liveState = createCandleState(FIXTURE_SEED, symbol, interval);
  const live = nextCandleFrame(liveState).frame;
  return { history, live };
}

/** All snapshots for a single symbol, ready to embed in SSR HTML. */
export type SymbolFixture = {
  symbol: string;
  orderbook: OrderbookL2Frame;
  trades: TradePrintFrame[];
  ticker: TickerFrame;
  funding: FundingFrame;
  candles: { history: Candle[]; live: CandleFrame };
};

function buildSymbolFixture(symbol: string): SymbolFixture {
  return {
    symbol,
    orderbook: orderbookSnapshot(symbol),
    trades: tradesSnapshot(symbol, 20),
    ticker: tickerSnapshot(symbol),
    funding: fundingSnapshot(symbol),
    candles: candlesSnapshot(symbol, "1m", 60),
  };
}

/** Frozen, deterministic fixtures keyed by symbol. */
export const tradeFixtures: Record<FixtureSymbol, SymbolFixture> = {
  BTC: buildSymbolFixture("BTC"),
  ETH: buildSymbolFixture("ETH"),
};

/** Convenience accessor; throws for an unknown fixture symbol. */
export function getFixture(symbol: FixtureSymbol): SymbolFixture {
  return tradeFixtures[symbol];
}
