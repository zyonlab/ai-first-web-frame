/**
 * `createTradeDataClient(ctx)` — the frozen **C4** ergonomic entry for all A2
 * fragments. It pre-registers every trade source for a set of symbols and wraps
 * the core `createDataClient` **without changing its signatures**: the returned
 * object is exactly a `createDataClient` result (`readData` / `preloadData` /
 * `mutateData` / `subscribeData`) plus two small conveniences:
 *
 * - `sourceIds` — the C5 id constructors, so a fragment reads
 *   `client.readData(client.sourceIds.ticker("BTC"), { symbol: "BTC" })`.
 * - `subscribe(id, handler, opts)` — thin sugar over `subscribeData` that, when
 *   no `transport` is supplied, auto-attaches the deterministic mock transport
 *   for a transport-backed source (falling back to the core poll loop
 *   otherwise). Fragments that want the raw poll loop just call `subscribeData`.
 *
 * Dedupe/partitioning are unchanged: all fragments on a page share ONE client
 * per SSR request (spine §4.1), so `readData` coalesces concurrent reads of the
 * same `createDataKey` (symbol/interval/grouping in `params`, tenant/user in
 * `ctx`). Never construct a per-fragment client for shared symbol data.
 */

import type { RequestContext } from "@mvp/contracts";
import {
  type CacheAdapter,
  createDataClient,
  type DataCacheEntry,
  type DataSource,
  type DataSubscriptionEvent,
  type MockScheduler,
  type SubscribeDataOptions,
} from "@mvp/data";
import { sourceIds } from "./sourceIds";
import {
  accountSource,
  balancesSource,
  candleHistorySource,
  fundingSource,
  leverageTiersSource,
  liveCandleSource,
  marketsIndexSource,
  mockTransportFor,
  orderbookSource,
  ordersSource,
  positionsSource,
  sessionWalletSource,
  symbolMetaSource,
  tickerSource,
  tradesSource,
} from "./tradeSources";

/** Which symbols (and candle intervals) to pre-register sources for. */
export type TradeDataClientOptions = {
  ctx: RequestContext;
  /** Symbols to pre-register per-symbol sources for. Defaults to `["BTC","ETH"]`. */
  symbols?: string[];
  /** Candle intervals to pre-register per (symbol, interval). Defaults to `["1m"]`. */
  intervals?: string[];
  /** Legacy Map storage or any CacheAdapter (shared across the SSR request). */
  cache?: Map<string, DataCacheEntry> | CacheAdapter;
  /** Extra sources to append (e.g. a fragment-local source not in the catalog). */
  extraSources?: Array<DataSource<unknown, never>>;
  now?: () => number;
  /** Deterministic seed for auto-attached mock transports. */
  transportSeed?: number;
  /** Injectable scheduler for auto-attached mock transports (tests). */
  transportScheduler?: MockScheduler;
};

/**
 * Widens a typed `DataSource<TData, TParams>` to the erased `DataSource` the
 * client registry stores. Safe: `createDataKey`/`load` are only ever called
 * with the params the caller passes to `readData`/`subscribeData`, and the
 * runtime is param-shape agnostic. TypeScript rejects the direct assignment
 * because `load`'s `TParams` argument is contravariant.
 */
function asSource(source: DataSource<unknown, never>): DataSource {
  return source as unknown as DataSource;
}

/** Builds the full set of trade `DataSource`s for the given symbols/intervals. */
export function buildTradeSources(
  symbols: string[],
  intervals: string[],
): Array<DataSource> {
  const sources: Array<DataSource> = [
    positionsSource(),
    ordersSource(),
    accountSource(),
    balancesSource(),
    marketsIndexSource(),
    sessionWalletSource(),
  ];
  for (const symbol of symbols) {
    sources.push(
      asSource(orderbookSource(symbol)),
      asSource(tradesSource(symbol)),
      asSource(tickerSource(symbol)),
      asSource(fundingSource(symbol)),
      asSource(symbolMetaSource(symbol)),
      asSource(leverageTiersSource(symbol)),
    );
    for (const interval of intervals) {
      sources.push(
        asSource(liveCandleSource(symbol, interval)),
        asSource(candleHistorySource(symbol, interval)),
      );
    }
  }
  return sources;
}

export type TradeDataClient = ReturnType<typeof createDataClient> & {
  /** C5 id constructors (see `./sourceIds`). */
  readonly sourceIds: typeof sourceIds;
  /**
   * `subscribeData` sugar: auto-attaches the deterministic mock transport for a
   * transport-backed source when no `transport` is passed. Falls back to the
   * core poll loop for near-realtime sources with no mock feed.
   */
  subscribe: <TData = unknown, TParams = Record<string, unknown>>(
    id: string,
    handler: (event: DataSubscriptionEvent<TData>) => void,
    options?: SubscribeDataOptions<TParams>,
  ) => () => void;
};

/**
 * Creates a trade data client pre-registered with every trade source. The
 * returned client IS a `createDataClient` result (same signatures) plus
 * `sourceIds` + `subscribe`.
 */
export function createTradeDataClient(
  options: TradeDataClientOptions,
): TradeDataClient {
  const symbols = options.symbols ?? ["BTC", "ETH"];
  const intervals = options.intervals ?? ["1m"];
  const sources: Array<DataSource> = [
    ...buildTradeSources(symbols, intervals),
    ...(options.extraSources ?? []).map(asSource),
  ];

  const client = createDataClient({
    ctx: options.ctx,
    sources,
    cache: options.cache,
    now: options.now,
  });

  function subscribe<TData = unknown, TParams = Record<string, unknown>>(
    id: string,
    handler: (event: DataSubscriptionEvent<TData>) => void,
    subOptions: SubscribeDataOptions<TParams> = {},
  ): () => void {
    const transport =
      subOptions.transport ??
      mockTransportFor(id, {
        seed: options.transportSeed,
        scheduler: options.transportScheduler,
        intervalMs: subOptions.intervalMs,
      });
    return client.subscribeData<TData, TParams>(id, handler, {
      ...subOptions,
      ...(transport ? { transport } : {}),
    });
  }

  return { ...client, sourceIds, subscribe };
}
