/**
 * Deterministic, self-driving mock `SubscriptionTransport`.
 *
 * This implements the *existing* `SubscriptionTransport` interface from
 * `@mvp/data` (connect / onMessage / close), so `subscribeData` drives it with
 * zero changes: passing `options.transport` disables polling and wires
 * `onMessage -> deliver`. Production swaps in a real WebSocket/SSE transport
 * implementing the same three methods.
 *
 * Relationship to `createMemorySubscriptionTransport` (in `@mvp/data`):
 * - `createMemorySubscriptionTransport` is *push-on-demand* — a test calls
 *   `.publish(frame)` to deliver an exact payload. Use it for contract tests
 *   that assert on precise delivery semantics.
 * - `createMockSubscriptionTransport` (here) is the *"with content"* version: it
 *   self-drives on an injectable timer, advancing a seeded PRNG each tick and
 *   emitting the next synthetic frame for the feed inferred from
 *   `connect({ sourceId })`. Use it for the running demo (and for tests that
 *   want a realistic, deterministic animated stream via fake timers).
 *
 * Determinism: everything is seeded. Same `(seed, symbol)` ⇒ byte-identical
 * frame stream. No `Date.now`/`Math.random` anywhere in the emitted frames.
 */

import type { SubscriptionTransport } from "@mvp/data";
import {
  type BookGenState,
  type CandleGenState,
  createBookState,
  createCandleState,
  createFundingState,
  createTickerState,
  createTradeState,
  type FundingGenState,
  type MarketFrame,
  nextCandleFrame,
  nextFundingFrame,
  nextOrderbookFrame,
  nextTickerFrame,
  nextTradeFrame,
  type TickerGenState,
  type TradeGenState,
} from "./frames";

/** Which synthetic stream this transport emits, chosen from the sourceId. */
export type MockFeed =
  | "orderbook.l2"
  | "trades.prints"
  | "ticker.mark"
  | "funding.global"
  | "candles.live";

/** Injectable timer handle so tests advance time without real setInterval. */
export type MockScheduler = {
  setInterval: (fn: () => void, ms: number) => { clear: () => void };
};

export type MockTransportOptions = {
  /** Deterministic seed; same seed + symbol ⇒ identical stream. */
  seed: number;
  /**
   * Symbol driving the stream together with `seed`. Optional: when omitted the
   * symbol is read from the `key`/`params` at connect time is NOT attempted —
   * pass it explicitly (the demo constructs one transport per (feed, symbol)).
   */
  symbol: string;
  /**
   * Explicit feed override. When omitted the feed is inferred from the
   * `sourceId` passed to `connect` (e.g. `"orderbook.l2"` -> orderbook frames).
   */
  feed?: MockFeed;
  /** Candle interval when the feed is `candles.live`. Defaults to `"1m"`. */
  interval?: string;
  /** Emission cadence in ms. Defaults to 1000 (realtime). */
  intervalMs?: number;
  /** Order-book depth (levels per side). Defaults to 12. */
  depth?: number;
  /**
   * Injectable scheduler. Defaults to the global `setInterval`. Inject a fake
   * one in tests, or rely on `vi.useFakeTimers()` patching the global.
   */
  scheduler?: MockScheduler;
};

/** Maps a `sourceId` (from `connect`) to a concrete feed, if recognized. */
export function feedForSourceId(sourceId: string): MockFeed | undefined {
  switch (sourceId) {
    case "orderbook.l2":
    case "trades.prints":
    case "ticker.mark":
    case "funding.global":
    case "candles.live":
      return sourceId;
    default:
      return undefined;
  }
}

const defaultScheduler: MockScheduler = {
  setInterval(fn, ms) {
    const id = setInterval(fn, ms);
    return { clear: () => clearInterval(id) };
  },
};

/**
 * A stepper closes over the mutable generator state and returns the next frame
 * on each `step()`. One is built per (feed, symbol) when the transport connects.
 */
type Stepper = () => MarketFrame;

function makeStepper(feed: MockFeed, options: MockTransportOptions): Stepper {
  const { seed, symbol } = options;
  switch (feed) {
    case "orderbook.l2": {
      let state: BookGenState = createBookState(seed, symbol, {
        depth: options.depth,
      });
      return () => {
        const next = nextOrderbookFrame(state);
        state = next.state;
        return next.frame;
      };
    }
    case "trades.prints": {
      let state: TradeGenState = createTradeState(seed, symbol);
      return () => {
        const next = nextTradeFrame(state);
        state = next.state;
        return next.frame;
      };
    }
    case "ticker.mark": {
      let state: TickerGenState = createTickerState(seed, symbol);
      return () => {
        const next = nextTickerFrame(state);
        state = next.state;
        return next.frame;
      };
    }
    case "funding.global": {
      let state: FundingGenState = createFundingState(seed, symbol);
      return () => {
        const next = nextFundingFrame(state);
        state = next.state;
        return next.frame;
      };
    }
    case "candles.live": {
      let state: CandleGenState = createCandleState(
        seed,
        symbol,
        options.interval ?? "1m",
      );
      return () => {
        const next = nextCandleFrame(state);
        state = next.state;
        return next.frame;
      };
    }
  }
}

/**
 * Creates a deterministic self-driving mock transport. On `connect`, it infers
 * the feed (from `options.feed` or the `sourceId`), builds the seeded stepper,
 * and starts a timer that emits one frame per `intervalMs`. `close` clears the
 * timer and drops all listeners; nothing is emitted before connect or after
 * close.
 */
export function createMockSubscriptionTransport(
  options: MockTransportOptions,
): SubscriptionTransport {
  const listeners = new Set<(data: unknown) => void>();
  const scheduler = options.scheduler ?? defaultScheduler;
  const intervalMs = options.intervalMs ?? 1_000;
  let timer: { clear: () => void } | undefined;
  let connected = false;

  function emit(frame: MarketFrame) {
    if (!connected) return;
    for (const listener of listeners) listener(frame);
  }

  return {
    connect({ sourceId }) {
      if (connected) return;
      const feed = options.feed ?? feedForSourceId(sourceId);
      if (!feed) {
        throw new Error(
          `createMockSubscriptionTransport: cannot infer feed from sourceId "${sourceId}"; pass options.feed`,
        );
      }
      const step = makeStepper(feed, options);
      connected = true;
      timer = scheduler.setInterval(() => {
        emit(step());
      }, intervalMs);
    },
    onMessage(listener) {
      listeners.add(listener);
    },
    close() {
      connected = false;
      timer?.clear();
      timer = undefined;
      listeners.clear();
    },
  };
}
