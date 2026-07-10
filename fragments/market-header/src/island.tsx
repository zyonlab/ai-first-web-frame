"use client";

import type { FundingFrame, TickerFrame } from "@mvp/data";
import { createInteractionBus, type InteractionBus } from "@mvp/interaction";
import { createRequestContext } from "@mvp/request-context";
import {
  type ActiveSymbolPayload,
  TRADE_ACTIVE_SYMBOL,
  tradeSliceContracts,
} from "@mvp/trade-contracts";
import { createTradeDataClient } from "@mvp/trade-data";
import { useEffect, useMemo, useReducer } from "react";
import {
  computeCountdown,
  type MarketHeaderView,
  toMarketHeaderView,
} from "./data";
import type { MarketHeaderIslandProps } from "./render";

/** This island's declared subscriber identity on the interaction bus (C3). */
export const MARKET_HEADER_SUBSCRIBER = "market-header" as const;

/**
 * Island reducer state: the current view + the countdown seed. Pure and
 * serializable so it can resume from the SSR snapshot with zero flash.
 */
export type IslandState = {
  view: MarketHeaderView;
  seededNowMs: number;
  countdownLabel: string;
};

export type IslandAction =
  | { type: "ticker"; ticker: TickerFrame; funding: FundingFrame }
  | { type: "tick"; nowMs: number }
  | { type: "symbol"; view: MarketHeaderView; seededNowMs: number };

/**
 * Pure island reducer (unit-tested in `island.logic.test.ts`). A `ticker` frame
 * produces a fresh view (reusing the last funding frame); a `tick` recomputes
 * only the countdown label against the seeded settlement time; a `symbol` swap
 * replaces the whole view after a resubscribe.
 */
export function islandReducer(
  state: IslandState,
  action: IslandAction,
): IslandState {
  switch (action.type) {
    case "ticker": {
      const view = toMarketHeaderView(action.ticker, action.funding);
      return { ...state, view };
    }
    case "tick": {
      const { label } = computeCountdown(
        state.view.nextFundingTs,
        action.nowMs,
      );
      if (label === state.countdownLabel) return state;
      return { ...state, countdownLabel: label };
    }
    case "symbol": {
      const { label } = computeCountdown(
        action.view.nextFundingTs,
        action.seededNowMs,
      );
      return {
        view: action.view,
        seededNowMs: action.seededNowMs,
        countdownLabel: label,
      };
    }
    default:
      return state;
  }
}

/** Builds the initial reducer state from the SSR snapshot props. */
export function initialIslandState(
  props: MarketHeaderIslandProps,
): IslandState {
  return {
    view: props.view,
    seededNowMs: props.seededNowMs,
    countdownLabel: props.countdownLabel,
  };
}

const COUNTDOWN_TICK_MS = 1000;

/**
 * The small near-realtime header island. Only this component re-renders on a
 * tick; the surrounding SSR fragment stays static. Mounts through
 * `@mvp/trade-client` (`registerIsland("marketHeader", MarketHeaderIsland)`),
 * reading its props from the inline JSON snapshot.
 *
 * Behaviour:
 *  - subscribes to `ticker:{symbol}` via the C4 client (`.subscribe` sugar
 *    auto-attaches the deterministic mock transport) and patches mark/change;
 *  - advances the funding countdown once per second off the seeded settlement
 *    time (no wall-clock drift between SSR and hydration);
 *  - subscribes to `TRADE_ACTIVE_SYMBOL` (C3) and, on a symbol switch, tears
 *    down the old ticker subscription and re-subscribes to the new symbol.
 */
export function MarketHeaderIsland(
  props: MarketHeaderIslandProps & { bus?: InteractionBus },
) {
  const [state, dispatch] = useReducer(
    islandReducer,
    props,
    initialIslandState,
  );

  // Keyed on the LIVE symbol (not the SSR prop) so a cross-fragment symbol
  // switch rebuilds the client for the new symbol and the ticker subscription
  // below re-establishes against it.
  const client = useMemo(() => {
    const ctx = createRequestContext();
    return createTradeDataClient({ ctx, symbols: [state.view.symbol] });
  }, [state.view.symbol]);

  // Prefer the page-injected shared bus so cross-fragment symbol switches reach
  // this island; fall back to a private bus for standalone/test rendering.
  const injectedBus = props.bus;
  const bus = useMemo(
    () =>
      injectedBus ?? createInteractionBus({ contracts: tradeSliceContracts }),
    [injectedBus],
  );

  // Keep the latest funding frame so a ticker patch can re-derive the view.
  const fundingRef = useMemo(
    () => ({ current: rebuildFunding(props.view) }),
    [props.view],
  );

  // Ticker subscription, re-established whenever the active symbol changes.
  useEffect(() => {
    const symbol = state.view.symbol;
    const unsubscribe = client.subscribe<TickerFrame>(
      client.sourceIds.ticker(symbol),
      (event) =>
        dispatch({
          type: "ticker",
          ticker: event.data,
          funding: fundingRef.current,
        }),
      { params: { symbol } },
    );
    return unsubscribe;
  }, [client, state.view.symbol, fundingRef]);

  // Cross-component symbol switch (C3): retarget the view to the new symbol.
  // The client memo + ticker subscription above are keyed on `state.view.symbol`,
  // so this dispatch alone re-establishes the live ticker for the new symbol;
  // the prior mark/oracle numbers show for one tick until the first frame lands.
  useEffect(() => {
    const unsubscribe = bus.subscribe(
      TRADE_ACTIVE_SYMBOL,
      (payload) => {
        const next = (payload as ActiveSymbolPayload).symbol?.trim();
        if (!next || next === state.view.symbol) return;
        dispatch({
          type: "symbol",
          view: { ...state.view, symbol: next },
          seededNowMs: Date.now(),
        });
      },
      { subscriber: MARKET_HEADER_SUBSCRIBER },
    );
    return unsubscribe;
  }, [bus, state.view]);

  // Countdown ticker.
  useEffect(() => {
    const id = setInterval(
      () => dispatch({ type: "tick", nowMs: Date.now() }),
      COUNTDOWN_TICK_MS,
    );
    return () => clearInterval(id);
  }, []);

  const view = state.view;
  const changeClass =
    view.direction === "up"
      ? "market-header__change--up"
      : view.direction === "down"
        ? "market-header__change--down"
        : "market-header__change--flat";

  return (
    <div className="market-header__row">
      <span className="market-header__pair" data-field="pair">
        {view.symbol}
      </span>
      <span className="market-header__stat" data-field="mark">
        <small className="market-header__caption">Mark</small>
        <b data-value="mark">{view.mark}</b>
      </span>
      <span className="market-header__stat" data-field="oracle">
        <small className="market-header__caption">Oracle</small>
        <b data-value="oracle">{view.oracle}</b>
      </span>
      <span
        className={`market-header__stat ${changeClass}`}
        data-field="change"
        data-direction={view.direction}
      >
        <small className="market-header__caption">24h</small>
        <b data-value="changePct">{view.changePct24h}</b>
      </span>
      <span className="market-header__stat" data-field="funding">
        <small className="market-header__caption">Funding</small>
        <b data-value="funding">{view.funding}</b>
      </span>
      <span className="market-header__stat" data-field="volume">
        <small className="market-header__caption">24h Vol</small>
        <b data-value="volume">{view.volume}</b>
      </span>
      <span
        className="market-header__stat market-header__countdown"
        data-field="countdown"
      >
        <small className="market-header__caption">Funding in</small>
        <time data-value="countdown">{state.countdownLabel}</time>
      </span>
    </div>
  );
}

/**
 * Rebuilds a minimal funding frame from a view so a ticker-only patch can
 * re-derive the view without a fresh funding read. Only the fields
 * `toMarketHeaderView` consumes are populated.
 */
function rebuildFunding(view: MarketHeaderView): FundingFrame {
  const rate = Number(view.funding.replace("%", "")) / 100;
  return {
    channel: "funding.global",
    symbol: view.symbol,
    seq: 0,
    ts: 0,
    rate: Number.isFinite(rate) ? rate : 0,
    nextFundingTs: view.nextFundingTs,
    intervalMs: view.fundingIntervalMs,
  };
}
