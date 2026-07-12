# @mvp/trade-data — AGENT.md

## What this package is for

`@mvp/trade-data` is the trade demo's data-source package: the canonical
source-id registry (contract **C5**), a `DataDependency` + loader definition
per trade source (freshness/privacy/cache aligned to
docs/trade-demo/03-data-architecture.md §1), and the `createTradeDataClient`
ergonomic helper (contract **C4**) that pre-registers them all on top of
`@mvp/data`'s `createDataClient` without changing any core signature. It is a
**domain-layer** package (`domains/`, not npm-published): it may import
framework packages (`@mvp/data`, `@mvp/contracts`) but framework packages must
never import it (`auditPackageLayering`, docs/ARCHITECTURE_REFACTOR_PLAN.md
§2.1). The source registry + client helper were moved out of `@mvp/data` in
the P1 re-layering (§2.2); the mock realtime transport under `./transport`
(seeded PRNG, pure `(state) -> { state, frame }` frame generators,
deterministic `tradeFixtures`, `createMockSubscriptionTransport`) moved here
from `packages/data/src/transport` in the B3 closure (PR #19) because it is
entirely trade-market-data-specific, not a framework primitive. Nothing here
modifies the `@mvp/data` core — it only composes it. Everything (transport
layer included) is exported from the single `.` root entry.

## Entry points

- `createTradeDataClient(options: TradeDataClientOptions): TradeDataClient` —
  `options: { ctx: RequestContext, symbols?: string[] = ["BTC","ETH"], intervals?: string[] = ["1m"], cache?: Map<string, DataCacheEntry> | CacheAdapter, extraSources?: DataSource[], now?: () => number, transportSeed?: number, transportScheduler?: MockScheduler }`.
  Returns exactly a `createDataClient` result (`readData` / `preloadData` /
  `mutateData` / `subscribeData`, same signatures, same dedupe/partitioning)
  plus `sourceIds` (the C5 constructors) and
  `subscribe<TData, TParams>(id, handler, options?): () => void` — sugar over
  `subscribeData` that auto-attaches the deterministic mock transport
  (`mockTransportFor`) when no `options.transport` is given, falling back to
  the core poll loop. Share ONE client per SSR request; never construct a
  per-fragment client for shared symbol data.
- `sourceIds` — the frozen C5 id registry: constructors
  `bookL2(symbol)`, `ticker(symbol)`, `trades(symbol)`,
  `candles(symbol, interval)`, `candlesHistory(symbol, interval)`,
  `funding(symbol)`, `symbolMeta(symbol)`, `leverageTiers(symbol)` (each
  `(...) => string`, e.g. `bookL2("btc") === "book.l2.BTC"`) plus the global
  constants `positions`, `orders`, `account`, `balances`, `marketsIndex`
  (`"markets.index"`), `sessionWallet` (`"session.wallet"`); enumerable as
  `GLOBAL_SOURCE_IDS`. Never hand-format ids. Companions:
  `normalizeSymbol(symbol: string): string` /
  `normalizeInterval(interval: string): string` and
  `parseSourceId(id: string): ParsedSourceId | undefined`
  (`{ kind: SourceKind, symbol?, interval? }`, `undefined` for foreign ids).
- Source factories, one per catalog row: `orderbookSource(symbol)`,
  `tradesSource(symbol)`, `tickerSource(symbol)`,
  `liveCandleSource(symbol, interval)`, `candleHistorySource(symbol, interval)`,
  `fundingSource(symbol)`, `symbolMetaSource(symbol)`,
  `leverageTiersSource(symbol)`, and the globals `positionsSource()`,
  `ordersSource()`, `accountSource()`, `balancesSource()`,
  `marketsIndexSource()`, `sessionWalletSource()` — each returns a typed
  `DataSource<TData, TParams>` whose `dependency` satisfies
  `DataDependencySchema` (realtime sources declare NO ttl) and whose `load`
  returns the deterministic fixture snapshot. `accountSource()` is the
  reference adoption of `@mvp/data`'s opt-in `DataSource.responseSchema`: it
  declares `AccountMarginSchema` (exported Zod schema, source of truth for the
  `AccountMargin` type), so a drifted `account` payload throws a
  `DataDependencyError` naming the schema instead of rendering wrong numbers.
  `buildTradeSources(symbols: string[], intervals: string[]): DataSource[]`
  assembles the full set (what `createTradeDataClient` registers).
- `tradeSourceRegistry: readonly TradeSourceEntry[]` — the enumerable catalog
  (`{ idTemplate, kind, scope, freshness, privacy, updateMode, subscribable, invalidationTags }`)
  consumed by the trace dependency graph and fragment discovery;
  `registryEntryFor(id: string): TradeSourceEntry | undefined` looks an entry
  up from a concrete id via `parseSourceId`.
- `mockTransportFor(id: string, options?: { seed?: number, scheduler?: MockScheduler, intervalMs?: number }): SubscriptionTransport | undefined`
  — builds the deterministic mock transport for a transport-backed source id
  (`book.l2.*`, `trades.*`, `ticker.*`, `funding.*`, `candles.<sym>.<iv>`);
  returns `undefined` for ISR/static/request-time sources so callers fall back
  to polling. `seed` defaults to `FIXTURE_SEED`; the same `(seed, symbol)`
  yields a byte-identical frame stream.
- `createMockSubscriptionTransport(options: MockTransportOptions): SubscriptionTransport`
  — the self-driving A0-mock transport itself
  (`{ seed, symbol, feed?, interval?, intervalMs? = 1000, depth? = 12, scheduler? }`);
  implements `@mvp/data`'s `connect`/`onMessage`/`close` so `subscribeData`
  drives it unchanged. `MockScheduler`
  (`{ setInterval(fn, ms): { clear() } }`) makes ticking injectable for tests;
  `feedForSourceId(sourceId: string): MockFeed | undefined` maps a transport
  channel name to a feed.
- Deterministic fixtures + generators (all re-exported from `./transport`):
  `FIXTURE_SEED` (`1337`), `tradeFixtures: Record<FixtureSymbol, SymbolFixture>`
  and `getFixture(symbol: FixtureSymbol): SymbolFixture` (BTC/ETH snapshots
  for SSR first paint / golden tests); pure frame generators
  (`createBookState`/`nextOrderbookFrame`, `createTradeState`/`nextTradeFrame`,
  `createTickerState`/`nextTickerFrame`, `createFundingState`/`nextFundingFrame`,
  `createCandleState`/`nextCandleFrame`, `seedCandles`) each stepping
  `(state) -> { state, frame }` with no wall-clock or `Math.random`; and the
  seeded PRNG (`createPrng(seed): Prng`, `deriveSeed`, `hashString`, `drawN`,
  `uniform`, `intBetween`, `gaussian`).

## Error taxonomy

- **Plain `Error`** — thrown by `normalizeSymbol`/`normalizeInterval` on an
  empty/whitespace-only input (`"source id symbol must be a non-empty string"`),
  and therefore by every symbol-scoped `sourceIds` constructor and source
  factory. Also thrown by `createMockSubscriptionTransport`'s `connect` when
  the feed cannot be inferred from the `sourceId` and `options.feed` was not
  passed. Both are always caller bugs.
- **`DataDependencyError`** (from `@mvp/data`, propagated unchanged) — the
  wrapped client's `readData`/`subscribeData` throw it for an unregistered
  source id (e.g. a symbol not in the client's `symbols` list) or when
  subscribing to a non-subscribable freshness tier (e.g. `symbol.meta.*`).
  This package neither catches nor wraps it — see `packages/data/AGENT.md`.
- Lookup helpers never throw: `parseSourceId`, `registryEntryFor`,
  `mockTransportFor`, and `feedForSourceId` all return `undefined` for an
  unrecognized/non-transport id so dependency-graph builders can skip foreign
  ids gracefully.

## Example

```ts
import type { RequestContext } from "@mvp/contracts";
import {
  createTradeDataClient,
  type MockScheduler,
  parseSourceId,
  registryEntryFor,
  sourceIds,
} from "@mvp/trade-data";

const ctx: RequestContext = {
  traceId: "trace-doc",
  requestId: "req-doc",
  locale: "en-US",
  tenant: "tenant-a",
  featureFlags: {},
  experiment: { bucket: "a" },
  theme: "system",
  device: "desktop",
  user: { id: "user-1" },
  userAgent: "docs-test",
  timestamp: new Date("2026-01-01T00:00:00.000Z").toISOString(),
};

// C5: constructed ids are canonical and round-trip through parseSourceId.
if (sourceIds.bookL2("btc") !== "book.l2.BTC") throw new Error("bad id");
const parsed = parseSourceId("candles.BTC.1m");
if (parsed?.kind !== "candles.live") throw new Error("bad parse");
if (registryEntryFor("book.l2.BTC")?.subscribable !== true) {
  throw new Error("book must be subscribable");
}

// Manual scheduler: the mock transport ticks only when WE say so — fully
// deterministic, no real timers left running.
const ticks: Array<() => void> = [];
const scheduler: MockScheduler = {
  setInterval(fn) {
    ticks.push(fn);
    return { clear: () => {} };
  },
};
const client = createTradeDataClient({ ctx, transportScheduler: scheduler });

// SSR read: deterministic fixture snapshot, loader on first read...
const ticker = await client.readData(client.sourceIds.ticker("BTC"), {
  symbol: "BTC",
});
if (ticker.source !== "loader") throw new Error("first read hits the loader");
if ((ticker.data as { symbol: string }).symbol !== "BTC") {
  throw new Error("wrong symbol");
}

// ...and an ISR source (symbol.meta, ttl 300) is a cache hit on the re-read.
await client.readData(client.sourceIds.symbolMeta("BTC"), { symbol: "BTC" });
const meta = await client.readData(client.sourceIds.symbolMeta("BTC"), {
  symbol: "BTC",
});
if (meta.source !== "cache") throw new Error("second read must be cached");

// C4 realtime: subscribe auto-attaches the seeded mock transport.
const frames: unknown[] = [];
const stop = client.subscribe(
  client.sourceIds.bookL2("BTC"),
  (event) => frames.push(event.data),
  { params: { symbol: "BTC" } },
);
ticks[0]?.(); // emit exactly one frame
await new Promise((resolve) => setTimeout(resolve, 0)); // flush async delivery
if (frames.length !== 1) throw new Error("expected exactly one frame");
const frame = frames[0] as { channel: string; symbol: string; spread: number };
if (frame.channel !== "orderbook.l2" || frame.symbol !== "BTC") {
  throw new Error("wrong frame");
}
if (!(frame.spread > 0)) throw new Error("book invariant: bid < ask");
stop();
console.log("trade-data example ok", frame.channel, frame.symbol);
```

## Accept

```
pnpm --filter @mvp/trade-data test
```
Expected: Vitest exits 0. `domains/trade-data/src/index.test.ts` covers the C5
id registry (construction, parsing, rejection of empty symbols), every
dependency's `DataDependencySchema` validity (realtime ⇒ no ttl), C4 read
dedupe/caching/key-partitioning, and mock-transport subscriptions;
`domains/trade-data/src/transport/transport.test.ts` covers the seeded PRNG's
reproducibility, the frame generators' market invariants, and
`createMockSubscriptionTransport`'s connect/emit/close lifecycle.
