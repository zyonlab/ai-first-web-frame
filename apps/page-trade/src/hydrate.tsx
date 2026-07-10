"use client";

import { AccountBarIsland } from "@mvp/fragment-account-bar/island";
import { accountBarManifest } from "@mvp/fragment-account-bar/manifest";
import { ChartPanelIsland } from "@mvp/fragment-chart-panel/island";
import { chartPanelManifest } from "@mvp/fragment-chart-panel/manifest";
import { MarketHeaderIsland } from "@mvp/fragment-market-header/island";
import { marketHeaderManifest } from "@mvp/fragment-market-header/manifest";
import {
  OrderFormIsland,
  type OrderFormIslandComponentProps,
} from "@mvp/fragment-order-form/island";
import { orderFormManifest } from "@mvp/fragment-order-form/manifest";
import type { InteractionBus } from "@mvp/interaction";
import {
  clearIslandRegistry,
  hydrateIslands,
  type IslandHandle,
  registerIsland,
} from "@mvp/islands";
import type { SliceStore } from "@mvp/store";
import {
  applySymbolSwitch,
  TRADE_ACTIVE_SYMBOL,
  TRADE_ORDER_DRAFT_PRICE,
  type TradeSlices,
} from "@mvp/trade-contracts";
import { createElement, useEffect } from "react";
import { startTradeRealtime } from "./realtime";
import { getTradeBus, getTradeStore } from "./tradeStore";

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
function makeOrderFormIsland(store: SliceStore<TradeSlices>) {
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
 * Registers the four React islands against the shared store. All three
 * read-mostly islands (market-header, chart, account-bar) are wrapped to
 * receive the shared page bus as an injected `bus` prop — each fragment's
 * `island.tsx` prefers that injected bus over its own private
 * `createInteractionBus` fallback (see each fragment's `island.tsx`), so
 * cross-island publishes reach them instead of being isolated: market-header
 * + chart subscribe to `TRADE_ACTIVE_SYMBOL` (watchlist symbol switches), and
 * account-bar now subscribes to `TRADE_LEVERAGE` (order-form leverage
 * changes) over the SAME shared bus instead of its own orphaned instance —
 * closing the gap `docs/ARCHITECTURE_REFACTOR_PLAN.md` §4.3.2 tracked. The
 * order-form is wrapped so it receives the shared store as `deps` (its
 * leverage/price flow goes through the store, not the bus). The signature
 * order-book → order-form price flow is fully wired end to end.
 *
 * Each registration also declares the fragment's own manifest `version` as
 * the C2 snapshot handshake's expected version (`@mvp/islands`
 * `registerIsland`'s third argument): if a fragment's live SSR snapshot ever
 * drifts from what this page-bundled island component was built against,
 * `hydrateIslands` skips hydration for that island and keeps the SSR HTML
 * static instead of silently mis-hydrating (§4.3.1).
 */
export function registerTradeIslands(
  store: SliceStore<TradeSlices>,
  bus: InteractionBus,
): void {
  // Inject the shared bus so market-header + chart + account-bar receive
  // cross-island publishes (symbol switches, leverage changes) instead of
  // being isolated on their own private bus instance.
  registerIsland(
    "marketHeader",
    (props: Omit<Parameters<typeof MarketHeaderIsland>[0], "bus">) =>
      createElement(MarketHeaderIsland, { ...props, bus }),
    { expectedVersion: marketHeaderManifest.version },
  );
  registerIsland(
    "chart",
    (props: Omit<Parameters<typeof ChartPanelIsland>[0], "bus">) =>
      createElement(ChartPanelIsland, { ...props, bus }),
    { expectedVersion: chartPanelManifest.version },
  );
  registerIsland(
    "accountBar",
    (props: Omit<Parameters<typeof AccountBarIsland>[0], "bus">) =>
      createElement(AccountBarIsland, { ...props, bus }),
    { expectedVersion: accountBarManifest.version },
  );
  registerIsland("orderForm", makeOrderFormIsland(store), {
    expectedVersion: orderFormManifest.version,
  });
}

/** Extracts an uppercased symbol from a watchlist row's `/trade/<sym>` href. */
function symbolFromHref(el: Element | null): string | null {
  const href = el?.getAttribute?.("href") ?? "";
  const match = /\/trade\/([^/?#]+)/.exec(href);
  return match ? decodeURIComponent(match[1]).trim().toUpperCase() : null;
}

/** Reads the symbol out of a `/trade/<sym>` pathname. */
function symbolFromPath(pathname: string): string | null {
  const match = /\/trade\/([^/?#]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]).trim().toUpperCase() : null;
}

/**
 * Progressive-enhancement in-place symbol switch. The watchlist rows are plain
 * `<a href="/trade/SYM">` (no-JS navigable); with JS this intercepts the click
 * and instead of a full-page navigation:
 *  - writes the symbol to the shared store (drives the realtime re-wire of
 *    order-book / trades / positions) AND publishes it on the shared bus (drives
 *    the market-header + chart islands),
 *  - updates the page `data-symbol` + active-row highlight, and
 *  - `pushState`s the new URL so the address bar + back button stay correct.
 * Back/forward (`popstate`) re-applies the switch without pushing history.
 */
export function attachSymbolSwitcher(
  store: SliceStore<TradeSlices>,
  bus: InteractionBus,
  root: ParentNode & {
    addEventListener: Element["addEventListener"];
    removeEventListener: Element["removeEventListener"];
  },
): () => void {
  const doc =
    (root as { ownerDocument?: Document }).ownerDocument ??
    (root as unknown as Document);
  const switchTo = (raw: string, push: boolean) => {
    const symbol = raw.trim().toUpperCase();
    if (!symbol) return;
    const page = doc.querySelector?.('[data-page="trade"]') ?? null;
    if (page?.getAttribute("data-symbol")?.toUpperCase() === symbol) return;
    void store.set(TRADE_ACTIVE_SYMBOL, applySymbolSwitch(symbol));
    // The bus contract for trade.active-symbol pins its declared publisher; use
    // it so the publish is accepted and reaches the chart + market-header.
    void bus.publish(TRADE_ACTIVE_SYMBOL, applySymbolSwitch(symbol), {
      owner: "symbol-switcher",
    });
    page?.setAttribute("data-symbol", symbol);
    for (const row of doc.querySelectorAll?.(".rail-watchlist__row") ?? []) {
      if (symbolFromHref(row) === symbol)
        row.setAttribute("aria-current", "page");
      else row.removeAttribute("aria-current");
    }
    if (push && typeof history !== "undefined") {
      history.pushState({ symbol }, "", `/trade/${symbol}`);
    }
  };
  const onClick = (event: Event) => {
    const row = (event.target as Element | null)?.closest?.(
      ".rail-watchlist__row",
    );
    const symbol = symbolFromHref(row ?? null);
    if (!symbol) return;
    event.preventDefault();
    switchTo(symbol, true);
  };
  const onPop = () => {
    const symbol =
      typeof location !== "undefined"
        ? symbolFromPath(location.pathname)
        : null;
    if (symbol) switchTo(symbol, false);
  };
  root.addEventListener("click", onClick);
  if (typeof window !== "undefined") window.addEventListener("popstate", onPop);
  return () => {
    root.removeEventListener("click", onClick);
    if (typeof window !== "undefined")
      window.removeEventListener("popstate", onPop);
  };
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
  store: SliceStore<TradeSlices>,
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
  root: ParentNode & {
    addEventListener: Element["addEventListener"];
    removeEventListener: Element["removeEventListener"];
  },
  store: SliceStore<TradeSlices>,
  bus: InteractionBus = getTradeBus(),
): { handles: IslandHandle[]; teardown: () => void } {
  registerTradeIslands(store, bus);
  const handles = hydrateIslands(root);
  const detachPrice = attachOrderbookPriceBridge(store, root);
  const detachSymbol = attachSymbolSwitcher(store, bus, root);
  return {
    handles,
    teardown() {
      detachSymbol();
      detachPrice();
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
    const { teardown } = hydrateTrade(document, store, getTradeBus());
    // Bring the patch-only panels (order-book / trades-feed / positions-table)
    // to life: subscribe each to its realtime source and apply frames to the
    // SSR DOM in place. The mock transport self-drives on a timer in the browser.
    const stopRealtime = startTradeRealtime(document, store);
    return () => {
      stopRealtime();
      teardown();
    };
  }, []);
  return null;
}
