"use client";

/**
 * Realtime wiring for the trade terminal's patch-only panels.
 *
 * This file used to BE the realtime layer: it knew which fragments were live,
 * which source id each one needed, and how to patch each one's DOM — roughly
 * 540 lines in which a fragment could not become live without a page edit. All
 * of that now ships with the fragments themselves, each behind its own `live`
 * export, and
 * the generic driver lives in `@mvp/runtime/live`.
 *
 * What is left here is only what the PAGE alone knows:
 *
 * 1. **Which live panels this page composes** — the array below, the non-React
 *    counterpart of `registerTradeIslands`'s island registry.
 * 2. **The current parameter values** — the active symbol, read from the page
 *    root and kept in sync with the shared store's `TRADE_ACTIVE_SYMBOL` slice.
 * 3. **A `subscribe` adapter** onto the trade data client. The driver only ever
 *    sees resolved source ids; the client, its mock transport and its seed stay
 *    a page concern.
 *
 * Adding a fourth live panel is now: declare `subscriptions` in the fragment's
 * manifest, ship a `live.ts`, and add one entry to `TRADE_LIVE_PANELS`.
 */

import { orderBookLivePanel } from "@mvp/fragment-order-book/live";
import { positionsTableLivePanel } from "@mvp/fragment-positions-table/live";
import { tradesFeedLivePanel } from "@mvp/fragment-trades-feed/live";
import { createRequestContext } from "@mvp/request-context";
import { type LivePanel, startLivePanels } from "@mvp/runtime/live";
import type { SliceStore } from "@mvp/store";
import { TRADE_ACTIVE_SYMBOL, type TradeSlices } from "@mvp/trade-contracts";
import {
  createTradeDataClient,
  type MockScheduler,
  type TradeDataClient,
} from "@mvp/trade-data";

/** The live (non-React) panels this page composes, in DOM order. */
export const TRADE_LIVE_PANELS: readonly LivePanel[] = [
  orderBookLivePanel,
  tradesFeedLivePanel,
  positionsTableLivePanel,
];

/** Options for {@link startTradeRealtime} — all optional; tests inject a scheduler. */
export type TradeRealtimeOptions = {
  /** Deterministic seed for the auto-attached mock transports. */
  transportSeed?: number;
  /** Injectable scheduler so tests advance frames without real timers. */
  transportScheduler?: MockScheduler;
  /**
   * Explicit client factory (tests may pass a pre-built client). Defaults to
   * `createTradeDataClient` with a minimal client-side request context.
   */
  createClient?: (symbols: string[]) => TradeDataClient;
  /** Panel set override, for tests that drive a single panel. */
  panels?: readonly LivePanel[];
};

/** Reads the active symbol from the page root, falling back to the store slice. */
export function resolveActiveSymbol(
  root: ParentNode,
  store: SliceStore<TradeSlices>,
): string {
  const pageEl =
    (root as Element).closest?.('[data-page="trade"][data-symbol]') ??
    root.querySelector?.('[data-page="trade"][data-symbol]') ??
    null;
  const fromDom = pageEl?.getAttribute?.("data-symbol");
  if (fromDom && fromDom.trim() !== "") return fromDom.trim().toUpperCase();
  return store.get(TRADE_ACTIVE_SYMBOL).symbol.trim().toUpperCase();
}

/**
 * Starts the realtime layer: mounts every declared live panel present under
 * `root` and keeps it subscribed for the active symbol, re-subscribing when the
 * shared store's active symbol changes. Returns a teardown that cancels all
 * subscriptions and the store listener.
 */
export function startTradeRealtime(
  root: ParentNode,
  store: SliceStore<TradeSlices>,
  options: TradeRealtimeOptions = {},
): () => void {
  const makeClient =
    options.createClient ??
    ((symbols: string[]) =>
      createTradeDataClient({
        ctx: createRequestContext({}),
        symbols,
        transportSeed: options.transportSeed,
        transportScheduler: options.transportScheduler,
      }));

  const symbol = resolveActiveSymbol(root, store);
  // One client per symbol set, rotated by `onParamsChange` before the panels
  // re-subscribe — a client's source list is fixed at construction, so a new
  // symbol needs a new client.
  let client: TradeDataClient = makeClient([symbol]);

  const controller = startLivePanels({
    root,
    panels: options.panels ?? TRADE_LIVE_PANELS,
    params: { symbol },
    subscribe: (source, onFrame) =>
      client.subscribe(source, (event) => onFrame(event.data)),
    onParamsChange: (next) => {
      client = makeClient([next.symbol as string]);
    },
  });

  const unsubscribeStore = store.subscribe(TRADE_ACTIVE_SYMBOL, (payload) => {
    const next = (payload as { symbol?: string }).symbol?.trim().toUpperCase();
    if (!next) return;
    controller.setParams({ symbol: next });
  });

  return () => {
    unsubscribeStore();
    controller.stop();
  };
}
