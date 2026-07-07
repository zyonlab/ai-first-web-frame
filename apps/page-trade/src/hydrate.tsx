"use client";

import { AccountBarIsland } from "@mvp/fragment-account-bar/island";
import { ChartPanelIsland } from "@mvp/fragment-chart-panel/island";
import { MarketHeaderIsland } from "@mvp/fragment-market-header/island";
import {
  OrderFormIsland,
  type OrderFormIslandComponentProps,
} from "@mvp/fragment-order-form/island";
import { TRADE_ORDER_DRAFT_PRICE, type TradeSlices } from "@mvp/interaction";
import type { TradeStore } from "@mvp/trade-client";
import {
  clearIslandRegistry,
  hydrateIslands,
  type IslandHandle,
  registerIsland,
} from "@mvp/trade-client";
import { createElement, useEffect } from "react";
import { getTradeStore } from "./tradeStore";

/**
 * Reads the numeric price from a clicked order-book row. The order-book is a
 * patch-only (vanilla) island, so its rows are plain SSR HTML: each row carries
 * `data-price` and its price cell is `[data-field="price"][data-value=...]`.
 * Mirrors `order-book/src/client.ts#priceFromRowElement` without importing that
 * fragment (page-trade only depends on the four React islands).
 */
export function priceFromRow(target: Element | null): number | null {
  const row = target?.closest?.("[data-price]") ?? null;
  if (!row) return null;
  const cell = row.querySelector?.('[data-field="price"]');
  const raw = cell?.getAttribute?.("data-value");
  const price = Number(raw);
  return Number.isFinite(price) ? price : null;
}

/**
 * The order-form island needs an injected `deps` bundle (shared store + user id
 * + cache invalidation). The C2 snapshot only carries the render props
 * (`symbol`/`draft`/`account`), so we wrap the real island and thread `deps`
 * from the page-owned shared store. This wrapper is what gets registered under
 * `"orderForm"`; `hydrateIslands` mounts it with the snapshot props.
 */
function makeOrderFormIsland(store: TradeStore<TradeSlices>) {
  return function OrderFormIslandBound(
    props: Omit<OrderFormIslandComponentProps, "deps">,
  ) {
    return createElement(OrderFormIsland, {
      ...props,
      deps: {
        store,
        // Client-side user identity is resolved by the shell in a full build;
        // the demo uses a stable placeholder so `{user}` invalidation tags
        // resolve deterministically. Real identity wiring is a P3 follow-up.
        userId: "demo-user",
      },
    } as OrderFormIslandComponentProps);
  };
}

/**
 * Registers the four React islands against the shared store. The three
 * read-mostly islands (market-header, chart, account-bar) mount straight from
 * their SSR snapshot props; the order-form is wrapped so it receives the shared
 * store as `deps`.
 *
 * NOTE (leftover / P3 follow-up): market-header + chart currently subscribe to
 * `TRADE_ACTIVE_SYMBOL`, and account-bar to `TRADE_LEVERAGE`, on their OWN
 * internal `createInteractionBus(tradeSliceContracts)` instances (see each
 * fragment's `island.tsx`). That satisfies the "can subscribe" bar but is NOT
 * yet bridged to this shared store's bus — a store→island bus bridge and the
 * live `subscribeData` realtime feed are deliberately deferred. The signature
 * order-book → order-form price flow below is fully wired end to end.
 */
export function registerTradeIslands(store: TradeStore<TradeSlices>): void {
  registerIsland("marketHeader", MarketHeaderIsland);
  registerIsland("chart", ChartPanelIsland);
  registerIsland("accountBar", AccountBarIsland);
  registerIsland("orderForm", makeOrderFormIsland(store));
}

/**
 * Attaches the signature cross-island flow via event delegation on `root`:
 * a click on an order-book row publishes its price on the shared store's
 * `TRADE_ORDER_DRAFT_PRICE` slice. The order-form island subscribes to that
 * slice and folds the price into its local draft (`foldOrderbookPrice`) —
 * updating ONLY the price input, with no re-render of the page or any other
 * fragment. Returns a teardown that removes the listener.
 */
export function attachOrderbookPriceBridge(
  store: TradeStore<TradeSlices>,
  root: ParentNode & { addEventListener: Element["addEventListener"] },
): () => void {
  const onClick = (event: Event) => {
    const price = priceFromRow(event.target as Element | null);
    if (price === null) return;
    void store.set(TRADE_ORDER_DRAFT_PRICE, { price });
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}

/**
 * One-shot hydration entry: register islands, mount every `[data-island]` node,
 * and wire the order-book price bridge. Returns the island handles + a teardown
 * that unmounts them and detaches the bridge. Safe to call once on mount.
 */
export function hydrateTrade(
  root: ParentNode & { addEventListener: Element["addEventListener"] },
  store: TradeStore<TradeSlices>,
): { handles: IslandHandle[]; teardown: () => void } {
  registerTradeIslands(store);
  const handles = hydrateIslands(root);
  const detach = attachOrderbookPriceBridge(store, root);
  return {
    handles,
    teardown() {
      detach();
      for (const handle of handles) handle.unmount();
      clearIslandRegistry();
    },
  };
}

/**
 * Client hydration boundary mounted after the fragment grid in `page.tsx`.
 * Renders nothing (the islands hydrate the SSR DOM in place); it exists purely
 * to run `hydrateTrade` once in the browser against the page-owned shared store.
 */
export function TradeHydrator() {
  useEffect(() => {
    const store = getTradeStore();
    const { teardown } = hydrateTrade(document, store);
    return teardown;
  }, []);
  return null;
}
