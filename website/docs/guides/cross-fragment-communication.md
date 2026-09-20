# Cross-fragment communication

Independently deployed fragments still have to talk: clicking a price in the order book has to
fill the order form. This is deliberately out of scope for Podium; here it is a contract.

## The contract

Each channel declares **one publisher**, an explicit subscriber list, and a Zod payload schema:

```ts
// domains/trade-contracts/src/slices.ts
export const tradeSliceContracts = [
  {
    channel: TRADE_ORDER_DRAFT_PRICE,      // "trade.order-draft.price"
    publisher: "order-book",
    subscribers: ["order-form"],
    payloadSchema: orderDraftPriceSchema,
  },
  // …
] as const;
```

The trade demo declares seven channels:

| Channel | Publisher | Subscribers |
| --- | --- | --- |
| `trade.active-symbol` | `symbol-switcher` | chart-panel, order-book, trades-feed, order-form, market-header, positions-table, account-bar |
| `trade.order-draft.price` | `order-book` | order-form |
| `trade.order-draft` | `order-form` | order-form, order-preview |
| `trade.chart-interval` | `chart-panel` | chart-panel |
| `trade.hovered-price` | `order-book` | order-form, chart-panel |
| `trade.book-grouping` | `order-book` | order-book |
| `trade.leverage` | `account-bar` | account-bar, order-form |

**Publisher and subscriber ids are logical component ids, not fragment names.**
`symbol-switcher` is an owner identity the page uses (`apps/page-trade/src/hydrate.tsx`), not a
service in `fragments/`. Getting this wrong is the most common integration mistake here.

`publisher` is singular: a channel has exactly one. If two components need to publish the same
concept, that is two channels or one shared owner identity — not a list.

## Using the bus

```ts
import { createInteractionBus, validateInteractionPayload } from "@mvp/interaction";

const bus = createInteractionBus({ contracts: tradeSliceContracts });

const off = bus.subscribe(TRADE_ORDER_DRAFT_PRICE, (payload) => setPrice(payload.price), {
  owner: "order-form",
});

bus.publish(TRADE_ORDER_DRAFT_PRICE, { price: 64000 }, { owner: "order-book" });
```

An undeclared publish, or a publish from an owner the contract does not name as the publisher,
throws `InteractionContractError` at runtime. Payloads are validated against `payloadSchema`.

`createBroadcastBridge` extends a bus across browser tabs over `BroadcastChannel`.

## Mutations

State changes that hit a backend are modelled explicitly rather than as fire-and-forget events:

```ts
import { defineMutation } from "@mvp/interaction";

const placeOrder = defineMutation({ /* input/output schemas + execute */ });
```

A contract violation raises `MutationContractError`. The order-form flow shows the pattern:
validate the order against the instrument's constraints **before** `placeOrder.execute` runs, so
an invalid order never reaches the matching engine.

## The client store

For state several islands read, the bus is paired with a single-owner slice store:

```ts
import { createSliceStore } from "@mvp/store";

const store = createSliceStore<TradeSlices>(tradeStoreContracts, {
  initial: structuredClone(initialTradeSlices),
  owner: TRADE_STORE_OWNER,
});

store.get(TRADE_ACTIVE_SYMBOL);
store.set(TRADE_ACTIVE_SYMBOL, { symbol: "ETH" });
store.subscribe(TRADE_ACTIVE_SYMBOL, (payload) => { /* … */ });
```

`useStoreSlice` is the React binding. Channels and slice keys line up by construction: a slice
name is the channel's topic tail, so `TradeSlices` keys match the contract channels.

The store is a **client-side mechanism**; the contracts are the source of truth. Two shapes of the
same list exist for that reason — `tradeSliceContracts` (island-level, canonical) and
`tradeStoreContracts` (reshaped for the generic store's type parameter).

## What is not checked

Nothing validates that a declared publisher or subscriber id corresponds to a component that
exists. `order-preview` appears as a subscriber and nowhere else in the repository
([F13](../known-limitations.md#f13)).
