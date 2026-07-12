import type { InteractionContract } from "@mvp/contracts";
import type { InteractionBus } from "@mvp/interaction";

/**
 * Trade-demo cross-component store slices (spine §7, data doc 03 §5).
 *
 * This module freezes contract **C3** (10-parallel-work-plan §3): the store
 * slice channel ids + Zod/JSON-Schema payloads + publisher/subscriber
 * declarations. It is demo-specific and lives under `domains/trade-contracts`
 * — the generic interaction bus/mutation core in `@mvp/interaction` stays
 * untouched; this only builds on top of it.
 *
 * Two contract sets are exported:
 *
 * - {@link tradeSliceContracts} — the **canonical island-level** contracts
 *   (each slice published by its real island: `symbol-switcher`, `order-form`,
 *   `order-book`, `chart-panel`). These wire the real multi-island bus that the
 *   A2/A3 fragment agents build; publisher discipline is enforced per doc §5.1.
 * - {@link tradeStoreContracts} — the same channels reshaped so the generic
 *   `@mvp/store`'s {@link "@mvp/store".createSliceStore} (single-owner get/set/
 *   subscribe) accepts them: every contract names {@link TRADE_STORE_OWNER} as
 *   publisher and includes it among subscribers. Feed these to
 *   `createSliceStore<TradeSlices>(tradeStoreContracts, { initial })`.
 *
 * Slice name === channel-topic-tail (the store maps a slice key to a channel),
 * so the {@link TradeSlices} keys line up with these channels for the store
 * generic.
 */

// --- Channel ids (frozen) ---------------------------------------------------

export const TRADE_ACTIVE_SYMBOL = "trade.active-symbol" as const;
export const TRADE_ORDER_DRAFT = "trade.order-draft" as const;
export const TRADE_ORDER_DRAFT_PRICE = "trade.order-draft.price" as const;
export const TRADE_CHART_INTERVAL = "trade.chart-interval" as const;
export const TRADE_HOVERED_PRICE = "trade.hovered-price" as const;
export const TRADE_BOOK_GROUPING = "trade.book-grouping" as const;
export const TRADE_LEVERAGE = "trade.leverage" as const;

/** The owner identity used by the generic single-owner client store. */
export const TRADE_STORE_OWNER = "trade-store" as const;

// --- Payload types ----------------------------------------------------------

export type OrderSide = "buy" | "sell";

/** Chart interval enum (data doc 03 §5.1 / candles.* params). */
export const CHART_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type ChartInterval = (typeof CHART_INTERVALS)[number];

export type ActiveSymbolPayload = { symbol: string };
export type OrderDraftPayload = {
  side: OrderSide;
  price?: number;
  size?: number;
  leverage: number;
  reduceOnly: boolean;
};
export type OrderDraftPricePayload = { price: number };
export type ChartIntervalPayload = { interval: ChartInterval };
export type HoveredPricePayload = { price: number | null };
export type BookGroupingPayload = { grouping: number };
export type LeveragePayload = { leverage: number };

// --- Payload schemas (minimal JSON-Schema subset validateInteractionPayload
//     understands: type / required / properties / enum / additionalProperties)

const activeSymbolSchema = {
  type: "object",
  required: ["symbol"],
  additionalProperties: false,
  properties: { symbol: { type: "string" } },
} as const;

const orderDraftPriceSchema = {
  type: "object",
  required: ["price"],
  additionalProperties: false,
  properties: { price: { type: "number" } },
} as const;

const orderDraftSchema = {
  type: "object",
  required: ["side", "leverage", "reduceOnly"],
  additionalProperties: false,
  properties: {
    side: { type: "string", enum: ["buy", "sell"] },
    price: { type: "number" },
    size: { type: "number" },
    leverage: { type: "number" },
    reduceOnly: { type: "boolean" },
  },
} as const;

const chartIntervalSchema = {
  type: "object",
  required: ["interval"],
  additionalProperties: false,
  properties: {
    interval: { type: "string", enum: [...CHART_INTERVALS] },
  },
} as const;

// hoveredPrice allows number OR null. The minimal schema validator checks
// `type` as a single string, so we omit `type` on the property and rely on
// `additionalProperties: false` + `required` to enforce shape; the null-or-
// number invariant is documented in the payload type and asserted in tests.
const hoveredPriceSchema = {
  type: "object",
  required: ["price"],
  additionalProperties: false,
  properties: { price: {} },
} as const;

const bookGroupingSchema = {
  type: "object",
  required: ["grouping"],
  additionalProperties: false,
  properties: { grouping: { type: "number" } },
} as const;

const leverageSchema = {
  type: "object",
  required: ["leverage"],
  additionalProperties: false,
  properties: { leverage: { type: "number" } },
} as const;

// --- Canonical island-level contracts (doc 03 §5.1) -------------------------

/**
 * Canonical C3 contracts with the real island publishers/subscribers from
 * data doc 03 §5.1. Used to construct the production multi-island interaction
 * bus (the A2/A3 fragment agents subscribe/publish against exactly these).
 *
 * Publisher discipline (enforced by `createInteractionBus`): the order-book
 * publishes a *price* only on the dedicated `trade.order-draft.price` channel;
 * the order-form is the sole writer of the full `trade.order-draft`.
 */
export const tradeSliceContracts = [
  {
    channel: TRADE_ACTIVE_SYMBOL,
    publisher: "symbol-switcher",
    subscribers: [
      "chart-panel",
      "order-book",
      "trades-feed",
      "order-form",
      "market-header",
      "positions-table",
      "account-bar",
    ],
    payloadSchema: activeSymbolSchema,
  },
  {
    channel: TRADE_ORDER_DRAFT_PRICE,
    publisher: "order-book",
    subscribers: ["order-form"],
    payloadSchema: orderDraftPriceSchema,
  },
  {
    channel: TRADE_ORDER_DRAFT,
    publisher: "order-form",
    subscribers: ["order-form", "order-preview"],
    payloadSchema: orderDraftSchema,
  },
  {
    channel: TRADE_CHART_INTERVAL,
    publisher: "chart-panel",
    subscribers: ["chart-panel"],
    payloadSchema: chartIntervalSchema,
  },
  {
    channel: TRADE_HOVERED_PRICE,
    publisher: "order-book",
    subscribers: ["order-form", "chart-panel"],
    payloadSchema: hoveredPriceSchema,
  },
  {
    channel: TRADE_BOOK_GROUPING,
    publisher: "order-book",
    subscribers: ["order-book"],
    payloadSchema: bookGroupingSchema,
  },
  {
    channel: TRADE_LEVERAGE,
    publisher: "order-form",
    subscribers: ["account-bar", "order-form"],
    payloadSchema: leverageSchema,
  },
  // M4 typed channels: `satisfies` (instead of a widening `InteractionContract[]`
  // annotation) keeps each contract's `channel` at its literal type, so
  // `createInteractionBus({ contracts: tradeSliceContracts })` infers
  // `InteractionBus<TradeChannel>` and a typo'd channel fails at compile time.
] satisfies ReadonlyArray<InteractionContract>;

/** The frozen union of trade channel ids (slice keys === bus channels). */
export type TradeChannel = (typeof tradeSliceContracts)[number]["channel"];

/** An interaction bus narrowed to the trade channel union (M4). */
export type TradeBus = InteractionBus<TradeChannel>;

// --- TradeSlices type + initial values --------------------------------------

/**
 * Slice map fed to the generic `createSliceStore<TradeSlices>`. Each key is a
 * slice/channel; the value type is the slice's stored value (NOT wrapped in the
 * `{ ... }` payload envelope — the store holds the raw slice value and the
 * channel payload carries it).
 *
 * NOTE the slice keys are the full channel ids, because `createSliceStore` maps
 * `slice -> channel` by identity (`String(slice)`). Using the channel id as the
 * slice key keeps store slices and bus channels in exact lockstep.
 */
export type TradeSlices = {
  [TRADE_ACTIVE_SYMBOL]: ActiveSymbolPayload;
  [TRADE_ORDER_DRAFT]: OrderDraftPayload;
  [TRADE_ORDER_DRAFT_PRICE]: OrderDraftPricePayload;
  [TRADE_CHART_INTERVAL]: ChartIntervalPayload;
  [TRADE_HOVERED_PRICE]: HoveredPricePayload;
  [TRADE_BOOK_GROUPING]: BookGroupingPayload;
  [TRADE_LEVERAGE]: LeveragePayload;
};

/** SSR snapshot seed / default slice values for the store. */
export const initialTradeSlices: TradeSlices = {
  [TRADE_ACTIVE_SYMBOL]: { symbol: "BTC" },
  [TRADE_ORDER_DRAFT]: {
    side: "buy",
    leverage: 1,
    reduceOnly: false,
  },
  [TRADE_ORDER_DRAFT_PRICE]: { price: 0 },
  [TRADE_CHART_INTERVAL]: { interval: "1m" },
  [TRADE_HOVERED_PRICE]: { price: null },
  [TRADE_BOOK_GROUPING]: { grouping: 1 },
  [TRADE_LEVERAGE]: { leverage: 1 },
};

// --- Store-compatible contracts (single-owner get/set/subscribe) ------------

/**
 * Contracts reshaped for the generic single-owner client store: publisher is
 * {@link TRADE_STORE_OWNER} and the owner is a subscriber, so
 * `createSliceStore<TradeSlices>(tradeStoreContracts, { initial })` can
 * `set` (publish) and `subscribe` every slice. The payload schemas are the
 * canonical ones — a bad slice value is still rejected at `set` time.
 *
 * This is a deliberate, isolated reshaping: the canonical island publishers
 * live in {@link tradeSliceContracts}; the store is a client-side mechanism and
 * uses a single owner identity by construction (see `@mvp/store`'s
 * `createSliceStore`).
 */
export const tradeStoreContracts: ReadonlyArray<
  InteractionContract & { channel: TradeChannel }
> = tradeSliceContracts.map((contract) => ({
  channel: contract.channel,
  publisher: TRADE_STORE_OWNER,
  subscribers: [TRADE_STORE_OWNER],
  payloadSchema: contract.payloadSchema,
}));

/** Type guard: valid chart interval. */
export function isChartInterval(value: unknown): value is ChartInterval {
  return (
    typeof value === "string" &&
    (CHART_INTERVALS as readonly string[]).includes(value)
  );
}
