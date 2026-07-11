# @mvp/trade-contracts — AGENT.md

## What this package is for

`@mvp/trade-contracts` is the trade demo's typed interaction-contract package:
it freezes contract **C3** — the cross-island store slice channels (ids +
payload schemas + publisher/subscriber ACLs), the place-order / cancel-order
mutation contracts, and the three canonical pure flow reducers (order-book
price → draft, leverage change → broadcast, symbol switch → active symbol).
It is a **domain-layer** package (`domains/`, not npm-published): it may
import framework packages (`@mvp/contracts`, `@mvp/interaction`) but framework
packages must never import it — that direction is a build failure under the
`auditPackageLayering` dependency-audit rule (docs/ARCHITECTURE_REFACTOR_PLAN.md
§2.1). It was moved out of `packages/interaction/src/trade` in the P1
re-layering (§2.2) so `@mvp/interaction` stays domain-agnostic; everything here
is *data and pure functions* handed to the framework — contracts are passed
into `createInteractionBus` (`@mvp/interaction`) or `createSliceStore`
(`@mvp/store`), never interpreted by this package itself. Everything is
exported from the single `.` root entry.

## Entry points

- Frozen channel ids (const strings): `TRADE_ACTIVE_SYMBOL`
  (`"trade.active-symbol"`), `TRADE_ORDER_DRAFT` (`"trade.order-draft"`),
  `TRADE_ORDER_DRAFT_PRICE` (`"trade.order-draft.price"`),
  `TRADE_CHART_INTERVAL` (`"trade.chart-interval"`), `TRADE_HOVERED_PRICE`
  (`"trade.hovered-price"`), `TRADE_BOOK_GROUPING` (`"trade.book-grouping"`),
  `TRADE_LEVERAGE` (`"trade.leverage"`); plus `TRADE_STORE_OWNER`
  (`"trade-store"`), the owner identity the single-owner client store uses.
- `tradeSliceContracts: InteractionContract[]` — the canonical
  **island-level** contracts: each channel published by its real island
  (`symbol-switcher`, `order-form`, `order-book`, `chart-panel`) with the real
  subscriber lists. Publisher discipline is deliberate: the order-book may
  publish only `{ price }` on `trade.order-draft.price`; the order-form is the
  sole writer of the full `trade.order-draft`.
- `tradeStoreContracts: InteractionContract[]` — the same channels reshaped
  for `@mvp/store`'s single-owner `createSliceStore`: every contract names
  `TRADE_STORE_OWNER` as `publisher` and sole subscriber, payload schemas
  unchanged (a bad slice value is still rejected at `set` time). Feed these to
  `createSliceStore<TradeSlices>(tradeStoreContracts, { initial: initialTradeSlices })`.
- `TradeSlices` (type) + `initialTradeSlices: TradeSlices` — the slice map for
  the store generic (keys are the full channel ids, values are the payload
  types `ActiveSymbolPayload`, `OrderDraftPayload`, ...) and its SSR snapshot
  seed. Related: `CHART_INTERVALS` (`["1m","5m","15m","1h","4h","1d"]`) and the
  guard `isChartInterval(value: unknown): value is ChartInterval`.
- `placeOrder: Mutation<PlaceOrderInput, PlaceOrderResult>` /
  `cancelOrder: Mutation<CancelOrderInput, CancelOrderResult>` —
  `defineMutation`-built contracts (`@mvp/interaction`) with JSON-Schema input
  validation and the declared invalidation-tag templates
  `PLACE_ORDER_INVALIDATES`
  (`["orders:{user}","positions:{user}","account:{user}","balances:{user}"]`)
  and `CANCEL_ORDER_INVALIDATES` (`["orders:{user}"]`).
- `resolveUserTags(templates: readonly string[], userId: string): string[]` —
  substitutes `{user}` in tag templates. Call it **inside your injected
  `io.invalidate` handler**, not via `execute(..., { invalidates })`: the
  undeclared-tag guard is a literal membership check, so a pre-resolved tag
  like `orders:u1` would be rejected. Companion:
  `createMockMatchingEngine(seed = 1): { place(input: PlaceOrderInput): PlaceOrderResult; cancel(input: CancelOrderInput): CancelOrderResult }`
  — the pure, seeded mock engine passed as `io.mutate` (market orders fill,
  limit orders rest as accepted).
- Flow reducers (pure, DOM-free):
  `applyOrderbookPrice(draft: OrderDraftPayload, incoming: OrderDraftPricePayload): OrderDraftPayload`
  (flow A: fold a book-row price into the draft, all other fields intact),
  `applyLeverageChange(draft: OrderDraftPayload, leverage: number): { payload: LeveragePayload; draft: OrderDraftPayload }`
  (flow B: broadcast payload + updated draft), and
  `applySymbolSwitch(symbol: string): ActiveSymbolPayload` (flow C).

## Error taxonomy

This package defines no error types and its own code never throws: the
contracts are plain data, the flow reducers and `createMockMatchingEngine` are
pure and total, and `isChartInterval`/`resolveUserTags` return values for any
input. Errors surface from `@mvp/interaction` when these exports are *used*:

- **`InteractionContractError`** — from a bus constructed over
  `tradeSliceContracts`/`tradeStoreContracts` when publishing on an undeclared
  channel, with the wrong `owner` identity, with a payload failing the slice
  schema, or subscribing with an undeclared `subscriber`.
- **`MutationContractError`** — from `placeOrder.execute`/`cancelOrder.execute`
  when the input fails the declared JSON-Schema or `options.invalidates`
  contains a tag outside the mutation's declared template set (including the
  resolved-tag footgun above — `orders:u1` is not a member of
  `["orders:{user}"]`). Thrown before `io.invalidate` runs.

See `packages/interaction/AGENT.md` for the full taxonomy of both.

## Example

```ts
import { createInteractionBus } from "@mvp/interaction";
import {
  applyOrderbookPrice,
  applySymbolSwitch,
  createMockMatchingEngine,
  initialTradeSlices,
  PLACE_ORDER_INVALIDATES,
  placeOrder,
  resolveUserTags,
  TRADE_ACTIVE_SYMBOL,
  TRADE_ORDER_DRAFT,
  TRADE_STORE_OWNER,
  tradeStoreContracts,
} from "@mvp/trade-contracts";

// Slice channels: wire the single-owner store bus and run flow C.
const bus = createInteractionBus({ contracts: tradeStoreContracts });
const seen: unknown[] = [];
const unsubscribe = bus.subscribe(
  TRADE_ACTIVE_SYMBOL,
  (payload) => {
    seen.push(payload);
  },
  { subscriber: TRADE_STORE_OWNER },
);
await bus.publish(TRADE_ACTIVE_SYMBOL, applySymbolSwitch("ETH"), {
  owner: TRADE_STORE_OWNER,
});
if (seen.length !== 1) throw new Error("expected exactly one slice update");
console.log("active symbol now", seen[0]); // { symbol: "ETH" }
unsubscribe();

// Flow A: fold an order-book price into the current draft, nothing else moves.
const draft = applyOrderbookPrice(initialTradeSlices[TRADE_ORDER_DRAFT], {
  price: 42000,
});
if (draft.price !== 42000 || draft.side !== "buy" || draft.leverage !== 1) {
  throw new Error("flow A must only set price");
}

// Mutation: declared template tags; {user} resolves in the invalidate handler.
const engine = createMockMatchingEngine(1);
const cacheInvalidated: string[] = [];
const { result, invalidated } = await placeOrder.execute(
  { symbol: "BTC", side: "buy", type: "market", size: 1, leverage: 5 },
  {
    mutate: (input) => engine.place(input),
    invalidate: (tags) => {
      cacheInvalidated.push(...resolveUserTags(tags, "u1"));
    },
  },
);
if (result.status !== "filled") throw new Error("market order must fill");
if (invalidated.length !== PLACE_ORDER_INVALIDATES.length) {
  throw new Error("must invalidate exactly the declared template set");
}
if (cacheInvalidated[0] !== "orders:u1") {
  throw new Error("handler must see user-resolved tags");
}
console.log("placed", result.orderId, "invalidated", cacheInvalidated);
```

## Accept

```
pnpm --filter @mvp/trade-contracts test
```
Expected: Vitest exits 0. `domains/trade-contracts/src/trade.test.ts` covers
the store/island contract shapes (single-owner reshaping, the order-draft
price fast-path split), payload/publisher rejection through a real bus, both
mutations' declared-tag enforcement plus `resolveUserTags`, and all three flow
reducers.
