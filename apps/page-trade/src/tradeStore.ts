import {
  initialTradeSlices,
  type TradeSlices,
  tradeStoreContracts,
} from "@mvp/interaction";
import { createTradeStore, type TradeStore } from "@mvp/trade-client";

/**
 * The single shared client store for the trade terminal (README §7 / §14 D4).
 *
 * D3's model is "React ships once at the page level": the page owns exactly one
 * `createTradeStore` instance and hands it to every island through the
 * hydration bootstrap. Islands never construct their own store — they read/write
 * slices on this one so a cross-island flow (an order-book row click driving the
 * order-form price) is a single `set`/`subscribe` pair on a shared bus.
 *
 * The instance is created lazily and memoized at module scope so the bootstrap
 * (`registerIslands` / `hydrateTrade`) and the order-book event delegation share
 * the *same* store without threading it through React context across the
 * SSR-HTML/`dangerouslySetInnerHTML` boundary (islands mount into detached SSR
 * nodes, so a React context provider above them would not reach them).
 */
let store: TradeStore<TradeSlices> | null = null;

/** Returns the process-wide shared trade store, creating it on first use. */
export function getTradeStore(): TradeStore<TradeSlices> {
  if (!store) {
    store = createTradeStore<TradeSlices>(tradeStoreContracts, {
      initial: initialTradeSlices,
    });
  }
  return store;
}

/**
 * Test/HMR helper: drops the memoized store so the next `getTradeStore()` builds
 * a fresh one (each test gets an isolated bus + slice values).
 */
export function resetTradeStore(): void {
  store = null;
}
