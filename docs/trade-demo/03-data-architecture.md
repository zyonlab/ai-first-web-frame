# 03 — Data Architecture

Last updated: 2026-07-06

> **Anchored to the [spine](README.md).** This document is the implementation-ready
> expansion of spine **§6 (Data architecture)** and **§7 (Cross-component store
> sharing)**. Where this doc and the spine conflict, the spine wins until amended
> there. Where this doc and its siblings ([02-component-architecture.md](02-component-architecture.md),
> [04-shadcn-and-styling.md](04-shadcn-and-styling.md)) conflict on a **shared store slice
> contract**, treat the contracts in [§5](#5-cross-component-shared-store-spine-7) here as
> canonical and file an amendment against the sibling.
>
> **All market data is synthetic.** Every value below is produced by a deterministic,
> seeded generator (mock `SubscriptionTransport` + mock loaders). There is **no live feed**,
> no external exchange, no real order routing. The transport interface is production-swappable
> to WebSocket/SSE, but the demo never ships a real one.

This doc is grounded in the existing framework primitives — do not invent new ones:

- `@mvp/data` — `createDataClient`, `readData` / `preloadData` / `subscribeData` /
  `mutateData`, `defineDataSource`, `createDataKey`, `CacheAdapter` /
  `MemoryCacheAdapter`, `SubscriptionTransport` / `createMemorySubscriptionTransport`.
  (`packages/data/src/index.ts`.)
- `@mvp/contracts` — `DataDependency` / `DataFreshness` / `DataPrivacy` / `CachePolicy`,
  `InteractionContract`. (`packages/contracts/src/index.ts`.)
- `@mvp/interaction` — `createInteractionBus`, `defineMutation`, `createBroadcastBridge`.
  (`packages/interaction/src/index.ts`.)
- `@mvp/runtime` — `executeFragmentSlots` with `dataDependencies` / `resolveData` /
  `health` / `hints`. (`packages/runtime/src/index.ts`.)
- Reference pattern for the SSR-snapshot + island-patch reducer:
  `apps/page-home/src/realtimeInsights.ts`.

---

## Table of contents

1. [Data-source catalog](#1-data-source-catalog-spine-6)
2. [Freshness → render strategy mapping](#2-freshness--render-strategy-mapping)
3. [Realtime transport (mock, production-swappable)](#3-realtime-transport-mock-production-swappable)
4. [Dedupe & cache partitioning](#4-dedupe--cache-partitioning)
5. [Cross-component shared store (spine §7)](#5-cross-component-shared-store-spine-7)
6. [Mutations + invalidation](#6-mutations--invalidation)
7. [Data-contract test points](#7-data-contract-test-points)
8. [Interface points that must stay in sync](#8-interface-points-that-must-stay-in-sync)

---

## 1. Data-source catalog (spine §6)

Every trade data source is modeled as a `DataDependency` (schema in
`packages/contracts/src/index.ts`). The columns below map 1:1 to the schema fields plus the
update mechanism. `owner` ∈ `shell | page | fragment | client-island`; `freshness` ∈
`static | build-time | isr | request-time | near-realtime | realtime | client-local`;
`privacy` ∈ `public | tenant | user-segment | user-private`.

Legend for **Update**: `poll Ns` = `subscribeData` polling loop at N seconds; `push` =
`SubscriptionTransport` push; `per-req` = resolved once per SSR request via `readData`;
`build` = build-time; `client` = computed client-side only.

### 1a. Global data (shell-owned)

| Source id | Data | freshness | owner | privacy | cache TTL | invalidationTags | Update |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `markets.index` | markets index (symbol list + last/change) | near-realtime | shell | public | 15s | `markets`, `markets:index` | poll 5s |
| `session.wallet` | session / wallet-connect state | request-time | shell | user-private | none | `session:{user}` | per-req |
| `funding.global` | global funding snapshot (all symbols) | near-realtime | shell | public | 30s | `funding`, `funding:global` | poll 5s |

### 1b. Page data (page-trade-owned)

| Source id | Data | freshness | owner | privacy | cache TTL | invalidationTags | Update |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `symbol.metadata` | symbol metadata (tick size, lot, decimals, maxLev) | isr | page | public | 300s | `symbol:{symbol}`, `symbol-meta` | per-req (ISR) |
| `candles.history` | candle history bootstrap (interval seed) | isr | page | public | 60s | `candles:{symbol}:{interval}` | per-req (ISR) |
| `candles.live` | live/last candle | near-realtime | page | public | none | `candles:{symbol}:{interval}` | poll 1s / push |
| `leverage.tiers` | leverage tiers / margin ladder | static | page | public | build | `leverage:{symbol}` | build |

### 1c. Component data (fragment-owned)

| Source id | Data | freshness | owner | privacy | cache TTL | invalidationTags | Update |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ticker.mark` | ticker / mark / oracle / 24h change | near-realtime | fragment | public | none | `ticker:{symbol}` | poll 1s / push |
| `orderbook.l2` | order book L2 (bid/ask ladder + depth) | **realtime** | fragment | public | **none** | `book:{symbol}` | push (poll 1s fallback) |
| `trades.prints` | trades tape (recent prints) | **realtime** | fragment | public | **none** | `trades:{symbol}` | push |
| `positions.open` | open positions (size/entry/liq/uPnL) | **realtime** | fragment | user-private | **none** | `positions:{user}`, `positions:{user}:{symbol}` | push |
| `orders.open` | working / open orders | realtime | fragment | user-private | **none** | `orders:{user}`, `orders:{user}:{symbol}` | push |
| `account.margin` | account margin (used/free/maint) | request-time + realtime | fragment | user-private | none | `account:{user}` | per-req seed + push |
| `account.balances` | balances (equity, withdrawable) | request-time | fragment | user-private | 5s | `balances:{user}` | per-req + poll 5s |

**Hard contract constraints (enforced by `DataDependencySchema.superRefine`):**

- `realtime` + `cachePolicy.ttl` is **rejected** — realtime sources (`orderbook.l2`,
  `trades.prints`, `positions.open`) MUST declare **no TTL**. `subscribeData` only writes a
  cache entry when `ttl > 0 && freshness !== "realtime"` (see `writeSubscriptionCache`), so a
  realtime source is intentionally never cached — every subscriber gets the live value.
- `source: "subscription"` requires `freshness: "realtime"`. Near-realtime sources
  (`ticker.mark`, `candles.live`, `markets.index`, `funding.global`) therefore declare
  `source: "api"` and either poll or ride the transport — the transport does not require the
  `subscription` source enum.
- `user-private` may not be `static` — hence `leverage.tiers` (static) is public and
  per-symbol, while anything keyed to a wallet is `request-time`/`realtime`.
- Only `realtime` and `near-realtime` are subscribable — `subscribeData` throws
  `DataDependencyError` for any other freshness. `client-local` throws in
  `validateRuntimeFreshness` if read during SSR (used for the store slices in §5, not data
  sources).

---

## 2. Freshness → render strategy mapping

The rule (spine §6): **static/build-time/ISR → SSR HTML that can cache; request-time →
SSR per request; realtime/near-realtime → SSR initial snapshot + island patch via
`subscribeData`.** The seam is always the same: the fragment SSR renders a **snapshot** into
the HTML, and the island resumes from that snapshot as its reducer's initial state (mirroring
`initialRealtimeState` → `realtimeInsightsReducer` in `apps/page-home/src/realtimeInsights.ts`).

| Source | freshness | SSR first paint | Island patch seam |
| --- | --- | --- | --- |
| `leverage.tiers` | static | Full HTML, baked at build; no island. | none |
| `symbol.metadata` | isr | SSR HTML, revalidated (TTL 300s). | none (metadata rarely changes mid-session; symbol switch re-fetches — §5 flow C) |
| `candles.history` | isr | SSR seeds the chart's initial series (last N candles). | `chart-panel` island hydrates the chart lib from the seeded series |
| `candles.live` | near-realtime | last candle embedded in the seeded series. | island `subscribeData("candles.live", …, { intervalMs: 1000 })` patches the last bar |
| `ticker.mark` | near-realtime | mark/change embedded in `market-header` HTML. | small island patches numbers via `subscribeData` (poll 1s / push) |
| `funding.global` / `funding-bar` | near-realtime | funding + next-funding countdown rendered server-side. | countdown ticks client-side; funding value patched on 5s poll |
| `orderbook.l2` | realtime | SSR renders the **snapshot ladder** (bids/asks/spread at request time). | **patch-only** island: `subscribeData("orderbook.l2")` replaces rows in place, no re-render of the SSR tree (spine §4/§5) |
| `trades.prints` | realtime | SSR renders the last M prints. | patch-only island prepends new prints, trims tail |
| `positions.open` | realtime | SSR renders positions rows from a per-request snapshot. | patch-only island patches uPnL/mark/liq cells |
| `orders.open` | realtime | SSR renders working orders. | patch-only island adds/removes rows on fill/cancel |
| `account.margin` | request-time + realtime | SSR renders the per-request margin baseline. | island patches margin as mark moves + on leverage change (§5 flow B) |
| `account.balances` | request-time | SSR renders equity/withdrawable per request. | poll-refresh (5s) small island |
| `session.wallet` | request-time | SSR renders connected/disconnected chrome. | none (connect handled by shadcn island, then full nav re-eval) |

**The snapshot → patch seam, concretely.** Each realtime/near-realtime fragment emits a
serialized snapshot alongside its HTML (small, JSON-serializable, exactly like
`RealtimeInsightsSnapshot`). The island's initial reducer state is that snapshot; the first
`subscribeData` event that is *identical* is dropped (`subscribeData` de-dupes on
`stableStringify` of the payload — `lastSerialized` guard), so there is no first-paint flash.
Late events for a stale key are ignored by the reducer's key/symbol guard (mirroring the
`snapshot.category !== state.category` check in `realtimeInsightsReducer`).

---

## 3. Realtime transport (mock, production-swappable)

The transport standing in for a WebSocket feed is a **deterministic, seeded generator**. It
satisfies the existing `SubscriptionTransport` interface (`packages/data/src/index.ts`) so
`subscribeData` drives it with **zero changes** — passing `options.transport` disables polling
and wires `onMessage → deliver`. Production swaps in a real WS/SSE transport implementing the
same three methods.

### 3.1 Existing interface (do not change)

```ts
// packages/data/src/index.ts — the contract we implement against
export type SubscriptionTransport = {
  connect: (options: {
    sourceId: string;
    key: string;
    dependency: DataDependency;
    ctx: RequestContext;
  }) => void | Promise<void>;
  onMessage: (listener: (data: unknown) => void) => void;
  close: () => void | Promise<void>;
};
```

### 3.2 Mock transport — interface signature draft

```ts
// packages/trade-client/src/mockTransport.ts (new; NOT in @mvp/data)
import type { SubscriptionTransport } from "@mvp/data";

/** Which synthetic stream this transport emits. Chosen from the sourceId on connect. */
export type MockFeed = "orderbook.l2" | "trades.prints" | "ticker.mark";

export type MockTransportOptions = {
  /** Deterministic seed; same seed + same symbol ⇒ identical stream (for tests + demo). */
  seed: number;
  /** Symbol drives the seed together with `seed`, so BTC and ETH diverge deterministically. */
  symbol: string;
  /** Emission cadence; defaults to the freshness default (realtime 1000ms). */
  intervalMs?: number;
  /** Injectable timer + clock so tests advance time without real setInterval. */
  scheduler?: {
    setInterval: (fn: () => void, ms: number) => { clear: () => void };
    now: () => number;
  };
};

/**
 * Deterministic mock transport. Advances a seeded PRNG each tick and emits the
 * next synthetic frame for the feed inferred from `connect({ sourceId })`.
 * `publish`/generation is internal — unlike `createMemorySubscriptionTransport`
 * (which is push-on-demand for tests), this one self-drives on a timer.
 */
export function createMockSubscriptionTransport(
  options: MockTransportOptions,
): SubscriptionTransport;

/** Pure frame generators — unit-testable without the transport shell. */
export function nextOrderbookFrame(state: BookGenState): { state: BookGenState; frame: OrderbookL2 };
export function nextTradeFrame(state: TradeGenState): { state: TradeGenState; frame: TradePrint };
export function nextTickerFrame(state: TickerGenState): { state: TickerGenState; frame: Ticker };
```

### 3.3 Design notes

- **Deterministic jitter.** A small seeded PRNG (e.g. mulberry32 over `hash(seed, symbol)`)
  drives price walk, book-level perturbation, and trade side/size. Same `(seed, symbol)` ⇒
  byte-identical stream ⇒ reproducible tests and a stable demo recording.
- **Feed selection by `sourceId`.** `connect({ sourceId })` picks the generator: `orderbook.l2`
  → ladder frames, `trades.prints` → single prints, `ticker.mark` → mark/change frames. One
  transport instance per (source, symbol) subscription.
- **Self-driving vs. `createMemorySubscriptionTransport`.** The in-repo memory transport is
  *push-on-demand* (a test calls `.publish(...)`). The mock trade transport self-drives on an
  injectable timer so the demo animates without a test harness. **Use
  `createMemorySubscriptionTransport` directly for deterministic contract tests** (publish exact
  frames, assert on delivery); use `createMockSubscriptionTransport` for the running demo.
- **Production swap.** A `createWsSubscriptionTransport(url)` implementing the same three methods
  drops in with no change to `subscribeData` or any fragment island. `connect` opens the socket
  and subscribes to `{sourceId, key}`; `onMessage` decodes frames; `close` tears down. The
  `key` passed to `connect` is the fully-partitioned `createDataKey` output, so a real gateway
  can route by tenant/user without extra plumbing.
- **Backpressure / coalescing** stays inside `subscribeData`: the `lastSerialized` guard already
  drops no-op frames; a fast feed that emits unchanged books costs one `stableStringify`, not a
  render.

---

## 4. Dedupe & cache partitioning

Two distinct dedupe problems, both already solved by existing primitives — the doc's job is to
*wire them*, not add machinery.

### 4.1 SSR-pass dedupe (same symbol read by many fragments)

Within one SSR request, `market-header`, `chart-panel`, `order-book`, and `order-form` all need
`ticker.mark` / `symbol.metadata` for the same symbol. `createDataClient.readData` already
dedupes:

- **In-flight coalescing:** a `pending` map keyed by `createDataKey` returns the same promise to
  concurrent readers; the second reader's result is tagged `source: "pending"`.
- **Cache hit reuse:** TTL'd sources (`symbol.metadata`, `candles.history`) are served from the
  `CacheAdapter` on the second read within TTL (tagged `source: "cache"`).

**Wiring rule:** all fragments on the trade page resolve their non-realtime data through **one
shared `createDataClient` per request** (constructed in `apps/page-trade`, threaded to slots via
`executeFragmentSlots({ dataDependencies, resolveData })`). The runtime scheduler additionally
emits a `duplicate-data-resolution` **`SchedulerHint`** when two slots declare the same
`dataDependencies` id — that hint is the optimizer's proof the dedupe is working (and a failing
gate if a fragment bypasses the shared client). Never construct a per-fragment client for shared
symbol data.

### 4.2 Client-side subscription sharing

On the client, multiple islands (order-book, trades-feed, market-header) may want the same
symbol's realtime feed. Rather than N sockets, the shared `packages/trade-client` store owns
**one `subscribeData` per (sourceId, symbol)** and fans out to island subscribers via the
interaction bus / a ref-counted subscription registry. Unsubscribe when the last island for a
key unmounts. This mirrors the SSR `pending` coalescing, one layer up.

### 4.3 Cache-key partitioning

`createDataKey` already partitions by privacy (`packages/data/src/index.ts`): `params` always;
`tenant` when privacy ≠ `public`; `experiment` for `user-segment`; `user` for `user-private`.
Trade-demo conventions layered on top:

| Partition axis | Carried by | Applies to |
| --- | --- | --- |
| `symbol` | `params.symbol` (always in `params`, so always in the key) | every symbol-scoped source |
| `interval` | `params.interval` | `candles.history`, `candles.live` |
| `grouping` | `params.grouping` | `orderbook.l2` (book grouping is a *param*, not a store-only concern — different grouping = different key) |
| `tenant` | `ctx.tenant` (auto, privacy ≠ public) | `markets.index` stays public; account/positions/orders are user-private |
| `locale` | via `params.locale` when copy differs | `symbol.metadata` display strings only |
| `user` | `ctx.user.id` (auto, user-private) | `positions.open`, `orders.open`, `account.*`, `session.wallet` |

**Key rule:** symbol/interval/grouping ride in `params` (so they distinguish keys and cache
entries); tenant/experiment/user ride in `ctx` (so `createDataKey` injects them by privacy).
Never fold a user id into `params` — it would defeat the privacy partitioning and leak across
the shared cache.

---

## 5. Cross-component shared store (spine §7)

The trade page has one **client store** (lives in `packages/trade-client`, spine §2). Its
slices are declared as typed **`InteractionContract`** channels on a `createInteractionBus`
(`packages/interaction/src/index.ts`). The store is `client-local` freshness — it never reads
during SSR (`validateRuntimeFreshness` throws for `client-local`), which is correct: these are
UI-interaction values, not server data.

> **These contracts are canonical for the whole trade demo.** [02](02-component-architecture.md)
> (island boundaries) and [04](04-shadcn-and-styling.md) (which shadcn island publishes what)
> MUST use exactly these channel names, publishers, subscribers, and payload schemas. See
> [§8](#8-interface-points-that-must-stay-in-sync).

### 5.1 Store slices

| Slice | Channel | Publisher (owner) | Subscribers | Payload |
| --- | --- | --- | --- | --- |
| `activeSymbol` | `trade.active-symbol` | `symbol-switcher` | `chart-panel`, `order-book`, `trades-feed`, `order-form`, `market-header`, `positions-table`, `account-bar` | `{ symbol: string }` |
| `orderDraft` | `trade.order-draft` | `order-form` | `order-form`, `order-preview` | `{ side, price?, size?, leverage?, reduceOnly? }` |
| `orderDraft.price` (fast-path) | `trade.order-draft.price` | `order-book` | `order-form` | `{ price: number }` |
| `chartInterval` | `trade.chart-interval` | `chart-panel` | `chart-panel` | `{ interval }` |
| `hoveredPrice` | `trade.hovered-price` | `order-book` | `order-form`, `chart-panel` | `{ price: number \| null }` |
| `bookGrouping` | `trade.book-grouping` | `order-book` | `order-book` | `{ grouping: number }` |
| `leverage` | `trade.leverage` | `order-form` | `account-bar`, `order-form` | `{ leverage: number }` |

> **Publisher discipline (enforced by `@mvp/interaction`).** `publish` throws
> `InteractionContractError` unless `owner === contract.publisher`, and `subscribe` throws
> unless the subscriber is declared. So the order-book publishing a *price* uses the separate
> `trade.order-draft.price` channel (publisher `order-book`) — it may **not** publish to
> `trade.order-draft` (publisher `order-form`). The order-form is the sole writer of the full
> draft; it folds the incoming price into its draft and re-emits. This keeps a single writer per
> canonical slice while still letting the book contribute a price.

### 5.2 Slice contract drafts (Zod-validated on bus construction)

```ts
// packages/trade-client/src/storeContracts.ts (new)
import type { InteractionContract } from "@mvp/contracts";

export const TRADE_ACTIVE_SYMBOL = "trade.active-symbol" as const;
export const TRADE_ORDER_DRAFT = "trade.order-draft" as const;
export const TRADE_ORDER_DRAFT_PRICE = "trade.order-draft.price" as const;
export const TRADE_CHART_INTERVAL = "trade.chart-interval" as const;
export const TRADE_HOVERED_PRICE = "trade.hovered-price" as const;
export const TRADE_BOOK_GROUPING = "trade.book-grouping" as const;
export const TRADE_LEVERAGE = "trade.leverage" as const;

export const tradeStoreContracts: InteractionContract[] = [
  {
    channel: TRADE_ACTIVE_SYMBOL,
    publisher: "symbol-switcher",
    subscribers: [
      "chart-panel", "order-book", "trades-feed", "order-form",
      "market-header", "positions-table", "account-bar",
    ],
    payloadSchema: {
      type: "object",
      required: ["symbol"],
      additionalProperties: false,
      properties: { symbol: { type: "string" } },
    },
  },
  {
    channel: TRADE_ORDER_DRAFT_PRICE,
    publisher: "order-book",
    subscribers: ["order-form"],
    payloadSchema: {
      type: "object",
      required: ["price"],
      additionalProperties: false,
      properties: { price: { type: "number" } },
    },
  },
  {
    channel: TRADE_ORDER_DRAFT,
    publisher: "order-form",
    subscribers: ["order-form", "order-preview"],
    payloadSchema: {
      type: "object",
      required: ["side"],
      additionalProperties: false,
      properties: {
        side: { type: "string", enum: ["buy", "sell"] },
        price: { type: "number" },
        size: { type: "number" },
        leverage: { type: "number" },
        reduceOnly: { type: "boolean" },
      },
    },
  },
  {
    channel: TRADE_LEVERAGE,
    publisher: "order-form",
    subscribers: ["account-bar", "order-form"],
    payloadSchema: {
      type: "object",
      required: ["leverage"],
      additionalProperties: false,
      properties: { leverage: { type: "number" } },
    },
  },
  // trade.chart-interval, trade.hovered-price, trade.book-grouping: same shape pattern.
];
```

The payload schemas use the minimal JSON-Schema subset that `validateInteractionPayload`
supports (`type` / `required` / `properties` / `enum` / `additionalProperties`) — identical to
the home-page pattern in `apps/page-home/src/interactionContracts.ts`. `additionalProperties:
false` is set deliberately so a mistyped field is rejected at publish time.

### 5.3 Canonical data flows (spine §7)

**Flow A — order-book row click → order-form price** (no SSR re-render):

```
user clicks bid row @ 63,412.5 in order-book island
  └─ order-book: bus.publish("trade.order-draft.price", { price: 63412.5 }, { owner: "order-book" })
       │  (contract validates: owner === publisher, price is number)
       ├─ tap listeners fire synchronously (BroadcastBridge → other tabs; devtools)
       └─ order-form handler receives { price }
            └─ order-form folds price into local draft, re-emits
                 bus.publish("trade.order-draft", { side, price: 63412.5, size, leverage }, { owner: "order-form" })
                   └─ order-preview updates its margin/cost preview
RESULT: only the order-form + order-preview islands patch. SSR page HTML, order-book
        ladder, chart, positions table are untouched (no React re-render of the tree).
```

**Flow B — leverage slider change → account-bar + order-form margin preview:**

```
user drags leverage slider (shadcn Slider island inside order-form) to 20x
  └─ order-form: bus.publish("trade.leverage", { leverage: 20 }, { owner: "order-form" })
       ├─ account-bar handler → recompute margin usage preview from account.margin snapshot + 20x
       │     (client-side preview only; no server round-trip until submit)
       └─ order-form handler → update its own margin/liq-price preview
RESULT: account-bar + order-form islands patch. account.margin data source is NOT re-read;
        the leverage is a client-local overlay on the last margin snapshot.
```

**Flow C — symbol switch in command palette → chart/book/form resubscribe, shell stable:**

```
user picks "ETH" in command palette (symbol-switcher island)
  └─ bus.publish("trade.active-symbol", { symbol: "ETH" }, { owner: "symbol-switcher" })
       ├─ order-book handler:
       │     unsubscribe old subscribeData("orderbook.l2", …, { params:{ symbol:"BTC", grouping } })
       │     subscribe   new subscribeData("orderbook.l2", …, { params:{ symbol:"ETH", grouping } })
       │        └─ new createDataKey (symbol differs) ⇒ fresh cache partition, fresh transport
       ├─ trades-feed handler: same resubscribe swap for trades.prints
       ├─ chart-panel handler: re-read candles.history (ISR) for ETH, resubscribe candles.live
       ├─ order-form handler: re-read symbol.metadata (tick/lot/maxLev) for ETH, reset draft
       └─ market-header handler: resubscribe ticker.mark for ETH
RESULT: every symbol-scoped island re-keys and resubscribes. The SHELL chrome
        (nav, wallet menu, theme/locale) does NOT re-render — it subscribes to none of
        these channels, and its data (session.wallet, markets.index) is symbol-independent.
```

The resubscribe-on-change discipline is exactly the `realtimeInsightsReducer` pattern
(`category-changed` resets state; stale-category snapshots are dropped) generalized to
`symbol`. Islands must guard delivered frames by the current key so an in-flight BTC frame
arriving after the ETH switch is discarded.

---

## 6. Mutations + invalidation

Placing and cancelling orders go through `defineMutation` (`packages/interaction/src/index.ts`).
Execution is **mock** (a seeded, deterministic fill/ack), but the contract — declared invalidation
tags, undeclared-tag rejection, injected `mutate` + `invalidate` — is real. `invalidate` is
wired to the request data client's `mutateData(tag)`, which fans out to
`cacheAdapter.delete(tag)` + `cacheAdapter.invalidateTags([tag])`.

### 6.1 Mutation contract drafts

```ts
// packages/trade-client/src/mutations.ts (new)
import { defineMutation } from "@mvp/interaction";

export type PlaceOrderInput = {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  size: number;
  price?: number;       // required for limit; validated in `mutate`
  leverage: number;
  reduceOnly?: boolean;
};
export type PlaceOrderResult = { orderId: string; status: "accepted" | "filled" };

export const placeOrder = defineMutation<PlaceOrderInput, PlaceOrderResult>({
  name: "trade.place-order",
  input: {
    type: "object",
    required: ["symbol", "side", "type", "size", "leverage"],
    additionalProperties: false,
    properties: {
      symbol:     { type: "string" },
      side:       { type: "string", enum: ["buy", "sell"] },
      type:       { type: "string", enum: ["market", "limit"] },
      size:       { type: "number" },
      price:      { type: "number" },
      leverage:   { type: "number" },
      reduceOnly: { type: "boolean" },
    },
  },
  // The complete set of tags this mutation is EVER allowed to invalidate.
  invalidates: [
    "orders:{user}",
    "positions:{user}",
    "account:{user}",
    "balances:{user}",
  ],
});

export type CancelOrderInput = { orderId: string; symbol: string };
export const cancelOrder = defineMutation<CancelOrderInput, { orderId: string; status: "cancelled" }>({
  name: "trade.cancel-order",
  input: {
    type: "object",
    required: ["orderId", "symbol"],
    additionalProperties: false,
    properties: { orderId: { type: "string" }, symbol: { type: "string" } },
  },
  invalidates: ["orders:{user}"],   // cancel only touches working orders
});
```

`{user}` is a placeholder resolved to `ctx.user.id` at call time so the invalidated tags match
the `createDataKey` partitions in §4.3. At the call site:

```ts
await placeOrder.execute(input, {
  mutate: mockMatchingEngine.place,          // deterministic seeded fill
  invalidate: (tags) => Promise.all(tags.map((t) => dataClient.mutateData(t))),
});
// place → invalidates orders/positions/account/balances ⇒ their next read/poll refetches.
// cancel → invalidates only orders ⇒ open-orders refreshes, positions untouched.
```

**Guarantee we demonstrate:** requesting an undeclared tag throws `MutationContractError`
**before any invalidation runs** (the scope check precedes `io.mutate`). So a mutation can never
blow away a cache partition it didn't declare — cancel-order can invalidate `orders:{user}` but
never `positions:{user}`.

### 6.2 Invalidation ↔ realtime relationship

Realtime sources (`positions.open`, `orders.open`) carry **no TTL cache**, so invalidation is
about the *near-realtime / request-time* readers (`account.balances`, `markets.index`). After a
fill, the mock matching engine also pushes the new position/order frame through the mock
transport, so the realtime panels update via subscription *and* the request-time balances refetch
on next poll after tag invalidation — the two mechanisms are complementary, not redundant.

---

## 7. Data-contract test points

Key tests to write (Vitest, root `vitest.config.ts`). Each is a hard, mechanical assertion —
these are the acceptance gates the data layer ships behind.

**Subscription isolation**
- A `subscribeData` on `orderbook.l2` for `symbol=BTC` delivers frames only to the BTC island;
  an ETH subscription for the same source receives none of them (different `createDataKey`).
- Publishing on `trade.order-draft.price` reaches only the `order-form` handler; the order-book
  island (publisher) is not re-entered, and no other channel's subscribers fire.
- The `lastSerialized` guard: two identical consecutive frames deliver the handler **once**.

**Dedupe**
- Two slots declaring `dataDependencies: ["ticker.mark"]` with the same `params` cause exactly
  **one** loader invocation per SSR pass; the second read reports `source: "pending"` or
  `source: "cache"`.
- `executeFragmentSlots` emits a `duplicate-data-resolution` `SchedulerHint` when two slots share
  a data id (asserts the optimizer sees the dedupe opportunity).
- Client store: N islands subscribing the same `(sourceId, symbol)` open exactly one underlying
  `subscribeData`; unmounting all of them tears it down.

**Invalidation scope**
- `placeOrder.execute` invalidates exactly `orders/positions/account/balances` for the calling
  user and nothing for another user (partition isolation via `{user}` → `ctx.user.id`).
- `cancelOrder.execute` invalidates `orders:{user}` only — a cached `positions:{user}` entry
  survives.
- Requesting an undeclared tag throws `MutationContractError` and performs **zero** invalidation
  (spy on `invalidate`, assert not called).
- `MemoryCacheAdapter.invalidateTags` evicts every entry whose `tags` intersect and leaves
  disjoint entries intact.

**Freshness / contract validation**
- `DataDependencySchema` rejects a `realtime` source with `cachePolicy.ttl` (all realtime trade
  sources parse only with no TTL).
- `subscribeData` throws `DataDependencyError` for a `request-time` / `isr` / `static` source
  (only realtime + near-realtime subscribe).
- `validateRuntimeFreshness` throws for `client-local` — asserts store slices can't be read as
  SSR data sources.
- `writeSubscriptionCache` never writes a cache entry for a realtime source (spy on
  `adapter.set`), and DOES invalidate the source's `invalidationTags` first for near-realtime
  cached sources.
- Every store `InteractionContract` payload schema round-trips through the bus: a valid payload
  passes; a missing required field or an extra field (`additionalProperties: false`) throws
  `InteractionContractError`.

---

## 8. Interface points that must stay in sync

These are the cross-doc contracts. Changing any of them requires a matching change in the named
doc (and often a spine amendment).

| Interface point | Canonical here | Consumed by | Sync requirement |
| --- | --- | --- | --- |
| **Store slice channels + payloads** (§5.1–5.2) | this doc | [02](02-component-architecture.md) island boundaries; [04](04-shadcn-and-styling.md) shadcn island → channel wiring | Channel names, publisher, subscribers, payload schema must match byte-for-byte. Publisher discipline means 02/04 must assign the *same* island as each channel's sole publisher. |
| **Data-source ids + freshness** (§1) | this doc | [02](02-component-architecture.md) fragment `dataDependencies`; [08](08-observability-and-trace-ui.md) trace lanes | Fragment manifests declare these exact ids; the trace-UI cache/subscription lanes key off them. |
| **Mock transport interface** (§3.2) | this doc | [09](09-shared-dependencies.md) `packages/trade-client` bundle | Transport lives in `trade-client` (shared island runtime), not `@mvp/data`; 09 must budget it as a shared dep. |
| **Mutation contracts + tags** (§6) | this doc | [02](02-component-architecture.md) order-form/open-orders islands; [07](07-deployment-examples.md) if order-book ships independently | Invalidation tags must equal the `createDataKey` partitions in §4.3. |
| **Cache-key partition axes** (§4.3) | this doc | `@mvp/data` `createDataKey` (fixed) + fragment `params` conventions | `symbol/interval/grouping` in `params`; `tenant/experiment/user` in `ctx`. Non-negotiable — deviating breaks dedupe + privacy. |
| **Snapshot → island-patch seam** (§2) | this doc | [02](02-component-architecture.md) render/hydration contract | Each realtime fragment emits a serialized snapshot; the island's reducer initial state IS that snapshot (the `realtimeInsights.ts` pattern). |

**Open items needing spine / sibling confirmation:**

- **`symbol-switcher` as `activeSymbol` publisher.** The spine (§3) puts the symbol
  quick-switcher (command palette) in the shell menu, but the store publisher must be a
  trade-page island so the shell doesn't re-render (flow C). Confirm with
  [06-navigation-and-routing.md](06-navigation-and-routing.md) that the command palette
  delegates the `activeSymbol` publish to a page-owned `symbol-switcher` island rather than
  publishing from shell chrome. Otherwise the shell subscribes-to-none guarantee is at risk.
- **`order-preview` island** (subscriber of `trade.order-draft`) is introduced here for the
  margin/cost preview; [02](02-component-architecture.md) must either adopt it as a distinct
  island or fold it into `order-form`. If folded, drop it from the subscriber list.
- **`bookGrouping` as both a store slice and a `params` axis** (§4.3 vs §5.1). Confirmed
  intentional: the slice holds the current UI selection; the value is threaded into
  `orderbook.l2` `params` so a grouping change re-keys the subscription (like a mini symbol
  switch). 02 should not model grouping as a second, separate data source.
