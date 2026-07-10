/**
 * Trade-demo data-source definitions (contract C5 payloads + C4 wiring).
 *
 * Each source is a `defineDataSource({ id, dependency, load })` where the
 * `dependency` is the `DataDependency` from `docs/trade-demo/03-data-architecture.md`
 * §1 (freshness / privacy / cachePolicy / invalidationTags) and `load` is the
 * SSR / poll loader. The A0-mock transport (frozen, read-only) supplies the
 * synthetic content:
 *
 * - **realtime** sources (`book.l2`, `trades`, `positions`, `orders`) declare
 *   **no ttl** (contract: realtime ≠ cache) and are driven client-side by a
 *   `createMockSubscriptionTransport` — build one with {@link mockTransportFor}
 *   and pass it to `subscribeData(id, handler, { transport })`. Their `load`
 *   returns the deterministic fixture snapshot so SSR first paint and the poll
 *   fallback have content.
 * - **near-realtime** sources (`ticker`, `candles.live`, `funding`,
 *   `markets.index`) declare a short ttl and either poll (`subscribeData` poll
 *   loop) or ride the same transport. `source: "api"` (not `"subscription"`) so
 *   they satisfy the `subscription ⇒ realtime` superRefine.
 * - **isr / static** sources (`candles.history`, `symbol.meta`,
 *   `leverage.tiers`) go through `readData` + a ttl cache (static uses a long
 *   ttl since there is no build step in the demo).
 * - **request-time** sources (`account`, `balances`, `session.wallet`) resolve
 *   per SSR request; `account` is additionally realtime-patched via the mock
 *   transport after its request-time seed (spine §5 flow B).
 *
 * Everything the loaders emit is derived from the frozen generators/fixtures in
 * `@mvp/data`'s transport layer; this module never invents literals.
 */

import type { DataDependency } from "@mvp/contracts";
import {
  type Candle,
  createMockSubscriptionTransport,
  type DataSource,
  defineDataSource,
  FIXTURE_SEED,
  type FixtureSymbol,
  type FundingFrame,
  getFixture,
  type MockScheduler,
  type OrderbookL2Frame,
  type SubscriptionTransport,
  type TickerFrame,
  type TradePrintFrame,
} from "@mvp/data";
import {
  normalizeInterval,
  normalizeSymbol,
  type ParsedSourceId,
  parseSourceId,
  sourceIds,
} from "./sourceIds";

// ---------------------------------------------------------------------------
// Loader params + payload shapes
// ---------------------------------------------------------------------------

/** Params carried by symbol-scoped loaders (rides in `createDataKey` params). */
export type SymbolParams = { symbol: string };
/** Params for candle sources (symbol + interval both partition the key). */
export type CandleParams = { symbol: string; interval: string };
/** Params for the order book (grouping is a key-partitioning param, §4.3). */
export type BookParams = { symbol: string; grouping?: number };

/** ISR symbol metadata payload (tick/lot/decimals/maxLev). */
export type SymbolMetadata = {
  symbol: string;
  tickSize: number;
  lotSize: number;
  priceDecimals: number;
  sizeDecimals: number;
  maxLeverage: number;
};

/** A single leverage tier (margin ladder rung). */
export type LeverageTier = {
  maxLeverage: number;
  maxNotional: number;
  maintenanceMarginRate: number;
};

/** Static leverage tiers payload. */
export type LeverageTiers = { symbol: string; tiers: LeverageTier[] };

/** Request-time account margin payload. */
export type AccountMargin = {
  equity: number;
  used: number;
  free: number;
  maintenance: number;
};

/** Request-time balances payload. */
export type Balances = {
  equity: number;
  withdrawable: number;
  unrealizedPnl: number;
};

/** Request-time session/wallet-connect payload. */
export type SessionWallet = {
  connected: boolean;
  address?: string;
};

/** A single open position (realtime). */
export type Position = {
  symbol: string;
  size: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  unrealizedPnl: number;
};

/** A single working order (realtime). */
export type WorkingOrder = {
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  price: number;
  size: number;
};

/** A markets-index row (near-realtime). */
export type MarketRow = {
  symbol: string;
  last: number;
  change24h: number;
  changePct24h: number;
};

// ---------------------------------------------------------------------------
// Deterministic derivations from the frozen fixtures
// ---------------------------------------------------------------------------

/** True for a symbol that has a baked fixture (BTC / ETH). */
function isFixtureSymbol(symbol: string): symbol is FixtureSymbol {
  return symbol === "BTC" || symbol === "ETH";
}

/**
 * The fixture used to seed SSR / poll for a symbol. Symbols without a baked
 * fixture fall back to BTC's shape (still deterministic) so unknown symbols do
 * not throw during a demo — the realtime transport supplies the real stream.
 */
function fixtureFor(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  return getFixture(isFixtureSymbol(normalized) ? normalized : "BTC");
}

function orderbookSnapshot(symbol: string): OrderbookL2Frame {
  return { ...fixtureFor(symbol).orderbook, symbol: normalizeSymbol(symbol) };
}

function tradesSnapshot(symbol: string): TradePrintFrame[] {
  const normalized = normalizeSymbol(symbol);
  return fixtureFor(symbol).trades.map((print) => ({
    ...print,
    symbol: normalized,
  }));
}

function tickerSnapshot(symbol: string): TickerFrame {
  return { ...fixtureFor(symbol).ticker, symbol: normalizeSymbol(symbol) };
}

function fundingSnapshot(symbol: string): FundingFrame {
  return { ...fixtureFor(symbol).funding, symbol: normalizeSymbol(symbol) };
}

function candleHistorySnapshot(symbol: string): Candle[] {
  return fixtureFor(symbol).candles.history;
}

function liveCandleSnapshot(symbol: string): Candle {
  return fixtureFor(symbol).candles.live.candle;
}

function symbolMetadata(symbol: string): SymbolMetadata {
  const ticker = tickerSnapshot(symbol);
  const price = ticker.mark;
  return {
    symbol: normalizeSymbol(symbol),
    tickSize: Math.max(0.01, Math.round(price * 0.0001 * 100) / 100),
    lotSize: 0.0001,
    priceDecimals: price >= 100 ? 2 : 4,
    sizeDecimals: 4,
    maxLeverage: 50,
  };
}

function leverageTiers(symbol: string): LeverageTiers {
  // Static ladder derived from the mark; deterministic per symbol.
  const mark = tickerSnapshot(symbol).mark;
  return {
    symbol: normalizeSymbol(symbol),
    tiers: [
      { maxLeverage: 50, maxNotional: mark * 10, maintenanceMarginRate: 0.005 },
      { maxLeverage: 25, maxNotional: mark * 100, maintenanceMarginRate: 0.01 },
      {
        maxLeverage: 10,
        maxNotional: mark * 1000,
        maintenanceMarginRate: 0.025,
      },
      {
        maxLeverage: 5,
        maxNotional: mark * 10000,
        maintenanceMarginRate: 0.05,
      },
    ],
  };
}

function positionsSnapshot(): Position[] {
  const btc = tickerSnapshot("BTC");
  const eth = tickerSnapshot("ETH");
  return [
    {
      symbol: "BTC",
      size: 0.5,
      entryPrice: btc.mark - 120,
      markPrice: btc.mark,
      liquidationPrice: btc.mark * 0.6,
      unrealizedPnl: Math.round(0.5 * 120 * 100) / 100,
    },
    {
      symbol: "ETH",
      size: -4,
      entryPrice: eth.mark + 8,
      markPrice: eth.mark,
      liquidationPrice: eth.mark * 1.4,
      unrealizedPnl: Math.round(-4 * -8 * 100) / 100,
    },
  ];
}

function ordersSnapshot(): WorkingOrder[] {
  const btc = tickerSnapshot("BTC");
  return [
    {
      orderId: "ord-1",
      symbol: "BTC",
      side: "buy",
      type: "limit",
      price: Math.round((btc.mark - 500) * 100) / 100,
      size: 0.25,
    },
  ];
}

function accountMargin(): AccountMargin {
  const positions = positionsSnapshot();
  const upnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const equity = 100_000 + upnl;
  const used = Math.round(equity * 0.2 * 100) / 100;
  return {
    equity: Math.round(equity * 100) / 100,
    used,
    free: Math.round((equity - used) * 100) / 100,
    maintenance: Math.round(used * 0.05 * 100) / 100,
  };
}

function balances(): Balances {
  const margin = accountMargin();
  return {
    equity: margin.equity,
    withdrawable: margin.free,
    unrealizedPnl: Math.round((margin.equity - 100_000) * 100) / 100,
  };
}

function marketsIndex(): MarketRow[] {
  return (["BTC", "ETH"] as const).map((symbol) => {
    const t = tickerSnapshot(symbol);
    return {
      symbol,
      last: t.last,
      change24h: t.change24h,
      changePct24h: t.changePct24h,
    };
  });
}

// ---------------------------------------------------------------------------
// DataDependency builders (freshness / privacy / cache aligned to 03 §1)
// ---------------------------------------------------------------------------

function realtimeDep(
  id: string,
  privacy: DataDependency["privacy"],
  invalidationTags: string[],
): DataDependency {
  return {
    id,
    owner: "fragment",
    // Near/realtime feeds declare `api`, NOT `subscription`: the transport is
    // passed to subscribeData at call time and the superRefine only allows
    // `subscription` for `realtime`. Using `api` keeps near-realtime valid too.
    source: "api",
    freshness: "realtime",
    privacy,
    // realtime ⇒ NO cachePolicy.ttl (contract superRefine rejects it).
    invalidationTags,
    dependsOn: [],
  };
}

function nearRealtimeDep(
  id: string,
  owner: DataDependency["owner"],
  privacy: DataDependency["privacy"],
  ttl: number,
  tags: string[],
  invalidationTags: string[],
): DataDependency {
  return {
    id,
    owner,
    source: "api",
    freshness: "near-realtime",
    privacy,
    cachePolicy: {
      ttl,
      tags,
      vary: privacy === "public" ? ["props"] : ["tenant", "props"],
    },
    invalidationTags,
    dependsOn: [],
  };
}

function isrDep(
  id: string,
  ttl: number,
  tags: string[],
  invalidationTags: string[],
): DataDependency {
  return {
    id,
    owner: "page",
    source: "api",
    freshness: "isr",
    privacy: "public",
    cachePolicy: { ttl, tags, vary: ["locale", "props"] },
    invalidationTags,
    dependsOn: [],
  };
}

function requestTimeDep(
  id: string,
  owner: DataDependency["owner"],
  invalidationTags: string[],
  ttl = 0,
  tags: string[] = [],
): DataDependency {
  return {
    id,
    owner,
    source: "api",
    freshness: "request-time",
    privacy: "user-private",
    ...(ttl > 0
      ? { cachePolicy: { ttl, tags, vary: ["tenant", "props"] } }
      : {}),
    invalidationTags,
    dependsOn: [],
  };
}

// ---------------------------------------------------------------------------
// Source factories (one per symbol / global)
// ---------------------------------------------------------------------------

/** `book.l2.<symbol>` — realtime order book ladder for one symbol. */
export function orderbookSource(
  symbol: string,
): DataSource<OrderbookL2Frame, BookParams> {
  const s = normalizeSymbol(symbol);
  return defineDataSource<OrderbookL2Frame, BookParams>({
    id: sourceIds.bookL2(s),
    dependency: realtimeDep(sourceIds.bookL2(s), "public", [`book:${s}`]),
    load: () => orderbookSnapshot(s),
  });
}

/** `trades.<symbol>` — realtime trades tape for one symbol. */
export function tradesSource(
  symbol: string,
): DataSource<TradePrintFrame[], SymbolParams> {
  const s = normalizeSymbol(symbol);
  return defineDataSource<TradePrintFrame[], SymbolParams>({
    id: sourceIds.trades(s),
    dependency: realtimeDep(sourceIds.trades(s), "public", [`trades:${s}`]),
    load: () => tradesSnapshot(s),
  });
}

/** `ticker.<symbol>` — near-realtime mark/last/24h change. */
export function tickerSource(
  symbol: string,
): DataSource<TickerFrame, SymbolParams> {
  const s = normalizeSymbol(symbol);
  return defineDataSource<TickerFrame, SymbolParams>({
    id: sourceIds.ticker(s),
    dependency: nearRealtimeDep(
      sourceIds.ticker(s),
      "fragment",
      "public",
      0,
      [`ticker:${s}`],
      [`ticker:${s}`],
    ),
    load: () => tickerSnapshot(s),
  });
}

/** `candles.<symbol>.<interval>` — near-realtime live candle. */
export function liveCandleSource(
  symbol: string,
  interval: string,
): DataSource<Candle, CandleParams> {
  const s = normalizeSymbol(symbol);
  const i = normalizeInterval(interval);
  return defineDataSource<Candle, CandleParams>({
    id: sourceIds.candles(s, i),
    dependency: nearRealtimeDep(
      sourceIds.candles(s, i),
      "page",
      "public",
      0,
      [`candles:${s}:${i}`],
      [`candles:${s}:${i}`],
    ),
    load: () => liveCandleSnapshot(s),
  });
}

/** `candles.history.<symbol>.<interval>` — ISR candle history bootstrap. */
export function candleHistorySource(
  symbol: string,
  interval: string,
): DataSource<Candle[], CandleParams> {
  const s = normalizeSymbol(symbol);
  const i = normalizeInterval(interval);
  return defineDataSource<Candle[], CandleParams>({
    id: sourceIds.candlesHistory(s, i),
    dependency: isrDep(
      sourceIds.candlesHistory(s, i),
      60,
      [`candles:${s}:${i}`],
      [`candles:${s}:${i}`],
    ),
    load: () => candleHistorySnapshot(s),
  });
}

/** `funding.<symbol>` — near-realtime funding snapshot. */
export function fundingSource(
  symbol: string,
): DataSource<FundingFrame, SymbolParams> {
  const s = normalizeSymbol(symbol);
  return defineDataSource<FundingFrame, SymbolParams>({
    id: sourceIds.funding(s),
    dependency: nearRealtimeDep(
      sourceIds.funding(s),
      "shell",
      "public",
      30,
      ["funding", `funding:${s}`],
      ["funding", `funding:${s}`],
    ),
    load: () => fundingSnapshot(s),
  });
}

/** `symbol.meta.<symbol>` — ISR symbol metadata. */
export function symbolMetaSource(
  symbol: string,
): DataSource<SymbolMetadata, SymbolParams> {
  const s = normalizeSymbol(symbol);
  return defineDataSource<SymbolMetadata, SymbolParams>({
    id: sourceIds.symbolMeta(s),
    dependency: isrDep(
      sourceIds.symbolMeta(s),
      300,
      ["symbol-meta", `symbol:${s}`],
      [`symbol:${s}`, "symbol-meta"],
    ),
    load: () => symbolMetadata(s),
  });
}

/** `leverage.tiers.<symbol>` — static leverage ladder. */
export function leverageTiersSource(
  symbol: string,
): DataSource<LeverageTiers, SymbolParams> {
  const s = normalizeSymbol(symbol);
  return defineDataSource<LeverageTiers, SymbolParams>({
    id: sourceIds.leverageTiers(s),
    dependency: {
      id: sourceIds.leverageTiers(s),
      owner: "page",
      source: "api",
      freshness: "static",
      privacy: "public",
      // No build step in the demo: cache statically with a long ttl.
      cachePolicy: {
        ttl: 86_400,
        tags: [`leverage:${s}`],
        vary: ["props"],
      },
      invalidationTags: [`leverage:${s}`],
      dependsOn: [],
    },
    load: () => leverageTiers(s),
  });
}

/** `positions` — realtime open positions (user-private). */
export function positionsSource(): DataSource<Position[]> {
  return defineDataSource<Position[]>({
    id: sourceIds.positions,
    dependency: realtimeDep(sourceIds.positions, "user-private", [
      "positions:{user}",
    ]),
    load: () => positionsSnapshot(),
  });
}

/** `orders` — realtime working orders (user-private). */
export function ordersSource(): DataSource<WorkingOrder[]> {
  return defineDataSource<WorkingOrder[]>({
    id: sourceIds.orders,
    dependency: realtimeDep(sourceIds.orders, "user-private", [
      "orders:{user}",
    ]),
    load: () => ordersSnapshot(),
  });
}

/** `account` — request-time + realtime account margin (user-private). */
export function accountSource(): DataSource<AccountMargin> {
  return defineDataSource<AccountMargin>({
    id: sourceIds.account,
    dependency: requestTimeDep(sourceIds.account, "fragment", [
      "account:{user}",
    ]),
    load: () => accountMargin(),
  });
}

/** `balances` — request-time balances (user-private, short ttl). */
export function balancesSource(): DataSource<Balances> {
  return defineDataSource<Balances>({
    id: sourceIds.balances,
    dependency: requestTimeDep(
      sourceIds.balances,
      "fragment",
      ["balances:{user}"],
      5,
      ["balances:{user}"],
    ),
    load: () => balances(),
  });
}

/** `markets.index` — near-realtime markets index (public). */
export function marketsIndexSource(): DataSource<MarketRow[]> {
  return defineDataSource<MarketRow[]>({
    id: sourceIds.marketsIndex,
    dependency: nearRealtimeDep(
      sourceIds.marketsIndex,
      "shell",
      "public",
      15,
      ["markets", "markets:index"],
      ["markets", "markets:index"],
    ),
    load: () => marketsIndex(),
  });
}

/** `session.wallet` — request-time session/wallet-connect (user-private). */
export function sessionWalletSource(): DataSource<SessionWallet> {
  return defineDataSource<SessionWallet>({
    id: sourceIds.sessionWallet,
    dependency: requestTimeDep(sourceIds.sessionWallet, "shell", [
      "session:{user}",
    ]),
    load: () => ({ connected: true, address: "0xMVP0000000000000000" }),
  });
}

// ---------------------------------------------------------------------------
// Registry (enumerable — for the trace dependency graph + fragment discovery)
// ---------------------------------------------------------------------------

/** How a trade source is driven at runtime — feeds the trace lanes / dep graph. */
export type SourceUpdateMode =
  | "subscription" // realtime, transport-driven
  | "poll" // near-realtime, subscribeData poll loop (or transport)
  | "isr" // readData + ttl cache, revalidated
  | "static" // readData + long ttl
  | "request-time"; // readData per request

/** A registry entry describing one trade source (or source family). */
export type TradeSourceEntry = {
  /** For symbol-scoped families this is a template like `book.l2.<symbol>`. */
  idTemplate: string;
  kind: ParsedSourceId["kind"];
  scope: "symbol" | "symbol+interval" | "global";
  freshness: DataDependency["freshness"];
  privacy: DataDependency["privacy"];
  updateMode: SourceUpdateMode;
  /** Whether a client subscription (`subscribeData`) is valid for this source. */
  subscribable: boolean;
  /** Base invalidation tags (symbol/user placeholders unexpanded). */
  invalidationTags: string[];
};

/**
 * The canonical, enumerable trade-source registry. Symbol-scoped entries use a
 * `<symbol>`/`<interval>` template id; global entries use the concrete id.
 * Consumed by A5-trace (dependency graph) and fragment discovery.
 */
export const tradeSourceRegistry: readonly TradeSourceEntry[] = [
  {
    idTemplate: "book.l2.<symbol>",
    kind: "book.l2",
    scope: "symbol",
    freshness: "realtime",
    privacy: "public",
    updateMode: "subscription",
    subscribable: true,
    invalidationTags: ["book:<symbol>"],
  },
  {
    idTemplate: "trades.<symbol>",
    kind: "trades",
    scope: "symbol",
    freshness: "realtime",
    privacy: "public",
    updateMode: "subscription",
    subscribable: true,
    invalidationTags: ["trades:<symbol>"],
  },
  {
    idTemplate: "ticker.<symbol>",
    kind: "ticker",
    scope: "symbol",
    freshness: "near-realtime",
    privacy: "public",
    updateMode: "poll",
    subscribable: true,
    invalidationTags: ["ticker:<symbol>"],
  },
  {
    idTemplate: "candles.<symbol>.<interval>",
    kind: "candles.live",
    scope: "symbol+interval",
    freshness: "near-realtime",
    privacy: "public",
    updateMode: "poll",
    subscribable: true,
    invalidationTags: ["candles:<symbol>:<interval>"],
  },
  {
    idTemplate: "candles.history.<symbol>.<interval>",
    kind: "candles.history",
    scope: "symbol+interval",
    freshness: "isr",
    privacy: "public",
    updateMode: "isr",
    subscribable: false,
    invalidationTags: ["candles:<symbol>:<interval>"],
  },
  {
    idTemplate: "funding.<symbol>",
    kind: "funding",
    scope: "symbol",
    freshness: "near-realtime",
    privacy: "public",
    updateMode: "poll",
    subscribable: true,
    invalidationTags: ["funding", "funding:<symbol>"],
  },
  {
    idTemplate: "symbol.meta.<symbol>",
    kind: "symbol.meta",
    scope: "symbol",
    freshness: "isr",
    privacy: "public",
    updateMode: "isr",
    subscribable: false,
    invalidationTags: ["symbol:<symbol>", "symbol-meta"],
  },
  {
    idTemplate: "leverage.tiers.<symbol>",
    kind: "leverage.tiers",
    scope: "symbol",
    freshness: "static",
    privacy: "public",
    updateMode: "static",
    subscribable: false,
    invalidationTags: ["leverage:<symbol>"],
  },
  {
    idTemplate: sourceIds.positions,
    kind: "positions",
    scope: "global",
    freshness: "realtime",
    privacy: "user-private",
    updateMode: "subscription",
    subscribable: true,
    invalidationTags: ["positions:{user}"],
  },
  {
    idTemplate: sourceIds.orders,
    kind: "orders",
    scope: "global",
    freshness: "realtime",
    privacy: "user-private",
    updateMode: "subscription",
    subscribable: true,
    invalidationTags: ["orders:{user}"],
  },
  {
    idTemplate: sourceIds.account,
    kind: "account",
    scope: "global",
    freshness: "request-time",
    privacy: "user-private",
    updateMode: "request-time",
    subscribable: false,
    invalidationTags: ["account:{user}"],
  },
  {
    idTemplate: sourceIds.balances,
    kind: "balances",
    scope: "global",
    freshness: "request-time",
    privacy: "user-private",
    updateMode: "request-time",
    subscribable: false,
    invalidationTags: ["balances:{user}"],
  },
  {
    idTemplate: sourceIds.marketsIndex,
    kind: "markets.index",
    scope: "global",
    freshness: "near-realtime",
    privacy: "public",
    updateMode: "poll",
    subscribable: true,
    invalidationTags: ["markets", "markets:index"],
  },
  {
    idTemplate: sourceIds.sessionWallet,
    kind: "session.wallet",
    scope: "global",
    freshness: "request-time",
    privacy: "user-private",
    updateMode: "request-time",
    subscribable: false,
    invalidationTags: ["session:{user}"],
  },
] as const;

/** Looks up the registry entry for a concrete or template id. */
export function registryEntryFor(id: string): TradeSourceEntry | undefined {
  const parsed = parseSourceId(id);
  if (!parsed) return undefined;
  return tradeSourceRegistry.find((entry) => entry.kind === parsed.kind);
}

// ---------------------------------------------------------------------------
// Mock transport wiring (client-side realtime — C4)
// ---------------------------------------------------------------------------

/** The transport-backed feeds (realtime + near-realtime that ride the transport). */
const TRANSPORT_FEED_BY_KIND: Partial<
  Record<
    ParsedSourceId["kind"],
    | "orderbook.l2"
    | "trades.prints"
    | "ticker.mark"
    | "funding.global"
    | "candles.live"
  >
> = {
  "book.l2": "orderbook.l2",
  trades: "trades.prints",
  ticker: "ticker.mark",
  funding: "funding.global",
  "candles.live": "candles.live",
};

/**
 * Builds a deterministic mock `SubscriptionTransport` for a given source id.
 * Pass the result to `subscribeData(id, handler, { transport })`. Returns
 * `undefined` for a non-transport source (ISR/static/request-time or the
 * position/order feeds that have no mock generator yet) so callers fall back to
 * the poll loop.
 *
 * The `(seed, symbol)` pair makes the stream reproducible; the same id + seed
 * yields a byte-identical frame sequence (see `../transport`).
 */
export function mockTransportFor(
  id: string,
  options: {
    seed?: number;
    scheduler?: MockScheduler;
    intervalMs?: number;
  } = {},
): SubscriptionTransport | undefined {
  const parsed = parseSourceId(id);
  if (!parsed?.symbol) return undefined;
  const feed = TRANSPORT_FEED_BY_KIND[parsed.kind];
  if (!feed) return undefined;
  return createMockSubscriptionTransport({
    seed: options.seed ?? FIXTURE_SEED,
    symbol: parsed.symbol,
    feed,
    interval: parsed.interval,
    scheduler: options.scheduler,
    intervalMs: options.intervalMs,
  });
}
