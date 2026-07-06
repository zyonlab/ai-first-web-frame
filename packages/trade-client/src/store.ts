import type { InteractionContract } from "@mvp/contracts";
import { createInteractionBus, type InteractionBus } from "@mvp/interaction";
import { useCallback, useSyncExternalStore } from "react";

/**
 * A generic client-side trade store built on `@mvp/interaction`.
 *
 * The store is generic over its slice map `TSlices` (e.g.
 * `{ activeSymbol: string; orderDraft: OrderDraft; ... }`). It intentionally
 * does NOT hard-code the concrete trade slices — those `InteractionContract`s
 * are defined by the P1 data agent and passed in at construction time. Each
 * slice name is a channel; `set` publishes the new value, `subscribe`/`get`
 * observe it.
 *
 * SSR-safe: it holds state in memory and never touches `window`/`document`, so
 * it can be constructed on the server without throwing. The `useStoreSlice`
 * hook uses `useSyncExternalStore`, which is server-render safe.
 */
export interface TradeStore<TSlices extends Record<string, unknown>> {
  /** Current value of a slice. */
  get<K extends keyof TSlices>(slice: K): TSlices[K];
  /** Sets a slice value and notifies its subscribers. */
  set<K extends keyof TSlices>(slice: K, value: TSlices[K]): Promise<void>;
  /** Subscribes to a slice; returns an unsubscribe fn. */
  subscribe<K extends keyof TSlices>(
    slice: K,
    listener: (value: TSlices[K]) => void,
  ): () => void;
  /** The underlying interaction bus (for advanced/bridge use). */
  bus: InteractionBus;
}

export interface CreateTradeStoreOptions<
  TSlices extends Record<string, unknown>,
> {
  /** Initial value for every slice (the SSR snapshot seed). */
  initial: TSlices;
  /**
   * Identity used when publishing/subscribing on the bus. Every provided
   * contract must name this as its `publisher` and include it in `subscribers`.
   * Defaults to `"trade-store"`.
   */
  owner?: string;
}

/**
 * Creates a typed trade store over the provided interaction contracts.
 *
 * One contract per slice/channel is required. Reading or writing a slice with
 * no declared contract throws (the same contract discipline `@mvp/interaction`
 * enforces), so slice typos surface immediately.
 */
export function createTradeStore<TSlices extends Record<string, unknown>>(
  contracts: InteractionContract[],
  options: CreateTradeStoreOptions<TSlices>,
): TradeStore<TSlices> {
  const owner = options.owner ?? "trade-store";
  const bus = createInteractionBus({ contracts });
  const declared = new Set(bus.listChannels());
  const values = new Map<keyof TSlices, TSlices[keyof TSlices]>(
    Object.entries(options.initial) as Array<
      [keyof TSlices, TSlices[keyof TSlices]]
    >,
  );

  function requireChannel(slice: keyof TSlices): string {
    const channel = String(slice);
    if (!declared.has(channel)) {
      throw new Error(
        `trade-store: slice "${channel}" has no declared interaction contract`,
      );
    }
    return channel;
  }

  return {
    bus,
    get(slice) {
      requireChannel(slice);
      return values.get(slice) as TSlices[typeof slice];
    },
    async set(slice, value) {
      const channel = requireChannel(slice);
      values.set(slice, value);
      await bus.publish(channel, value, { owner });
    },
    subscribe(slice, listener) {
      const channel = requireChannel(slice);
      return bus.subscribe(
        channel,
        (payload) => listener(payload as TSlices[typeof slice]),
        { subscriber: owner },
      );
    },
  };
}

/**
 * React hook that subscribes a component to a single store slice and re-renders
 * on change. Built on `useSyncExternalStore` so it is concurrent-mode and
 * SSR-render safe (the server snapshot returns the current value, no window).
 */
export function useStoreSlice<
  TSlices extends Record<string, unknown>,
  K extends keyof TSlices,
>(store: TradeStore<TSlices>, slice: K): TSlices[K] {
  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(slice, onChange),
    [store, slice],
  );
  const getSnapshot = useCallback(() => store.get(slice), [store, slice]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
