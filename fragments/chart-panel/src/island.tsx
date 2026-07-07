"use client";

import {
  type CandleFrame,
  createTradeDataClient,
  type Candle as DataCandle,
} from "@mvp/data";
import {
  type ActiveSymbolPayload,
  CHART_INTERVALS,
  type ChartInterval,
  type ChartIntervalPayload,
  createInteractionBus,
  isChartInterval,
  TRADE_ACTIVE_SYMBOL,
  TRADE_CHART_INTERVAL,
  tradeSliceContracts,
} from "@mvp/interaction";
import { createRequestContext } from "@mvp/request-context";
import type { Candle as ChartCandle } from "@mvp/trade-client";
import { CandleChart } from "@mvp/trade-client";
import { Tabs, TabsList, TabsTrigger } from "@mvp/ui/shadcn";
import { useEffect, useMemo, useReducer } from "react";
import {
  applyLiveCandle,
  buildIntervalPayload,
  intervalReducer,
  summarizeSeries,
  toChartSeries,
} from "./islandLogic";
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  type ChartPanelIslandProps,
} from "./render";

/** This island's declared subscriber/publisher identity on the bus (C3). */
export const CHART_PANEL_SUBSCRIBER = "chart-panel" as const;

/**
 * Island reducer state: the current symbol, interval, and candle series. Pure
 * and serializable so it resumes from the SSR snapshot with zero flash.
 */
export type ChartIslandState = {
  symbol: string;
  interval: ChartInterval;
  series: ChartCandle[];
};

export type ChartIslandAction =
  | { type: "live"; frame: CandleFrame }
  | { type: "interval"; interval: unknown; series?: ChartCandle[] }
  | { type: "symbol"; symbol: string; series: ChartCandle[] }
  | { type: "reload"; series: ChartCandle[] };

/**
 * Pure island reducer (unit-tested in `island.logic.test.ts` via the helpers it
 * delegates to). A `live` frame folds into the series with replace/append
 * semantics; an `interval` switch updates the interval (validated) and swaps in
 * the refetched series; a `symbol` swap replaces symbol + series; a `reload`
 * replaces just the series (after an interval/symbol refetch resolves).
 */
export function chartIslandReducer(
  state: ChartIslandState,
  action: ChartIslandAction,
): ChartIslandState {
  switch (action.type) {
    case "live": {
      const series = applyLiveCandle(state.series, action.frame);
      if (series === state.series) return state;
      return { ...state, series };
    }
    case "interval": {
      const interval = intervalReducer(state.interval, action.interval);
      if (interval === state.interval && !action.series) return state;
      return {
        ...state,
        interval,
        series: action.series ?? state.series,
      };
    }
    case "symbol": {
      if (action.symbol === state.symbol) return state;
      return { ...state, symbol: action.symbol, series: action.series };
    }
    case "reload": {
      return { ...state, series: action.series };
    }
    default:
      return state;
  }
}

/** Builds the initial reducer state from the SSR snapshot props. */
export function initialChartState(
  props: ChartPanelIslandProps,
): ChartIslandState {
  return {
    symbol: props.symbol,
    interval: props.interval,
    series: props.series,
  };
}

/**
 * The chart-panel island. Mounts through `@mvp/trade-client`
 * (`registerIsland("chart", ChartPanelIsland)`), reading its props from the
 * inline JSON snapshot. Only this component re-renders on a live candle; the
 * surrounding SSR fragment stays static.
 *
 * Behaviour:
 *  - draws the candle series onto the canvas via `<CandleChart>` (the shared C2
 *    canvas renderer — no external chart library);
 *  - interval control (shadcn Tabs) publishes `TRADE_CHART_INTERVAL` (C3,
 *    validated by `isChartInterval`), refetches the history for the new interval
 *    via C4, and re-subscribes the live candle;
 *  - subscribes to `TRADE_CHART_INTERVAL` to echo its own interval switches;
 *  - subscribes to `candles.<symbol>.<interval>` (C5 live) and folds each frame
 *    with replace/append semantics;
 *  - subscribes to `TRADE_ACTIVE_SYMBOL` (C3) and, on a symbol switch, refetches
 *    the history and re-subscribes to the live candle for the new symbol.
 */
export function ChartPanelIsland(props: ChartPanelIslandProps) {
  const [state, dispatch] = useReducer(
    chartIslandReducer,
    props,
    initialChartState,
  );

  const bus = useMemo(
    () => createInteractionBus({ contracts: tradeSliceContracts }),
    [],
  );

  // Live candle subscription, re-established on symbol/interval change.
  useEffect(() => {
    const ctx = createRequestContext();
    const client = createTradeDataClient({
      ctx,
      symbols: [state.symbol],
      intervals: [state.interval],
    });
    const unsubscribe = client.subscribe<CandleFrame>(
      client.sourceIds.candles(state.symbol, state.interval),
      (event) => dispatch({ type: "live", frame: event.data }),
      { params: { symbol: state.symbol, interval: state.interval } },
    );
    return unsubscribe;
  }, [state.symbol, state.interval]);

  // Interval control: publish TRADE_CHART_INTERVAL + refetch history (C4).
  async function onInterval(next: string): Promise<void> {
    const payload = buildIntervalPayload(next);
    if (!payload) return;
    await bus.publish(TRADE_CHART_INTERVAL, payload, {
      owner: CHART_PANEL_SUBSCRIBER,
    });
    const series = await refetchHistory(state.symbol, payload.interval);
    dispatch({ type: "interval", interval: payload.interval, series });
  }

  // Echo our own interval switches (C3 self-subscription).
  useEffect(() => {
    const unsubscribe = bus.subscribe(
      TRADE_CHART_INTERVAL,
      async (payload) => {
        const { interval } = payload as ChartIntervalPayload;
        if (!isChartInterval(interval) || interval === state.interval) return;
        const series = await refetchHistory(state.symbol, interval);
        dispatch({ type: "interval", interval, series });
      },
      { subscriber: CHART_PANEL_SUBSCRIBER },
    );
    return unsubscribe;
  }, [bus, state.symbol, state.interval]);

  // Cross-component symbol switch (C3): refetch history + resubscribe.
  useEffect(() => {
    const unsubscribe = bus.subscribe(
      TRADE_ACTIVE_SYMBOL,
      async (payload) => {
        const next = (payload as ActiveSymbolPayload).symbol
          ?.trim()
          .toUpperCase();
        if (!next || next === state.symbol) return;
        const series = await refetchHistory(next, state.interval);
        dispatch({ type: "symbol", symbol: next, series });
      },
      { subscriber: CHART_PANEL_SUBSCRIBER },
    );
    return unsubscribe;
  }, [bus, state.symbol, state.interval]);

  const summary = summarizeSeries(state.series);

  return (
    <div className="chart-panel__island" data-island="chart">
      <header className="chart-panel__header">
        <span className="chart-panel__pair" data-field="pair">
          {state.symbol}
        </span>
        <Tabs
          value={state.interval}
          onValueChange={onInterval}
          className="chart-panel__intervals"
        >
          <TabsList aria-label="Chart interval">
            {CHART_INTERVALS.map((iv) => (
              <TabsTrigger key={iv} value={iv} data-interval={iv}>
                {iv}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </header>
      {summary ? (
        <div
          className="chart-panel__summary"
          data-field="summary"
          data-direction={summary.direction}
        >
          <span className="chart-panel__stat" data-field="open">
            <small className="chart-panel__caption">O</small>
            <b data-value="open">{formatPrice(summary.open)}</b>
          </span>
          <span className="chart-panel__stat" data-field="high">
            <small className="chart-panel__caption">H</small>
            <b data-value="high">{formatPrice(summary.high)}</b>
          </span>
          <span className="chart-panel__stat" data-field="low">
            <small className="chart-panel__caption">L</small>
            <b data-value="low">{formatPrice(summary.low)}</b>
          </span>
          <span
            className={`chart-panel__stat chart-panel__close--${summary.direction}`}
            data-field="close"
          >
            <small className="chart-panel__caption">C</small>
            <b data-value="close">{formatPrice(summary.close)}</b>
          </span>
        </div>
      ) : null}
      <div className="chart-panel__canvas-wrap">
        <CandleChart
          series={state.series}
          interval={state.interval}
          width={CHART_WIDTH}
          height={CHART_HEIGHT}
        />
      </div>
    </div>
  );
}

/**
 * Refetches the candle history for a (symbol, interval) via the C4 client and
 * maps it to the chart series. Used on interval and symbol switches.
 */
async function refetchHistory(
  symbol: string,
  interval: ChartInterval,
): Promise<ChartCandle[]> {
  const ctx = createRequestContext();
  const client = createTradeDataClient({
    ctx,
    symbols: [symbol],
    intervals: [interval],
  });
  const result = await client.readData<DataCandle[]>(
    client.sourceIds.candlesHistory(symbol, interval),
    { symbol, interval },
  );
  return toChartSeries(result.data);
}

function formatPrice(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
