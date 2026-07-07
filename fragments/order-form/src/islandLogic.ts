import {
  applyLeverageChange,
  applyOrderbookPrice,
  type LeveragePayload,
  type OrderDraftPayload,
  type OrderDraftPricePayload,
  type OrderSide,
  type PlaceOrderInput,
} from "@mvp/interaction";

/**
 * Pure island logic for the order-form (contract C3 realized).
 *
 * Everything the `order-form` island does to cross-component state is expressed
 * here as pure functions/reducers so it can be unit-tested with no DOM/React:
 *
 * - `foldOrderbookPrice` — folds an incoming `trade.order-draft.price` (from an
 *   order-book row click) into the local draft via the frozen
 *   `applyOrderbookPrice` reducer. When the book supplies a price the order
 *   type flips to `limit` (a clicked price is a limit price).
 * - `changeLeverage` — a leverage-slider change; delegates to the frozen
 *   `applyLeverageChange` reducer to produce BOTH the `trade.leverage` broadcast
 *   payload and the next draft (leverage folded in). The island publishes the
 *   payload on `TRADE_LEVERAGE` and the whole draft on `TRADE_ORDER_DRAFT`.
 * - `setSide` / `setOrderType` / `setSize` / `setReduceOnly` — the remaining
 *   form fields, each returning a next draft (immutably).
 * - `toPlaceOrderInput` — projects the local draft onto the frozen
 *   `PlaceOrderInput` mutation contract for `placeOrder.execute`.
 * - `isDraftSubmittable` — the guard the submit button uses (size > 0, and a
 *   price present for limit orders).
 *
 * None of these touch the bus or the DOM; the island component wires them to
 * events and then publishes on the store. This keeps the C3 flow deterministic
 * and fully testable.
 */

export type OrderType = "market" | "limit";

/**
 * The order-form's local draft. It is the frozen `OrderDraftPayload` extended
 * with the form-only `type` field (market/limit) that is NOT part of the
 * cross-component draft slice but IS part of the place-order mutation input.
 */
export type OrderFormDraft = OrderDraftPayload & { type: OrderType };

/** The default draft used for the SSR first paint and store seed. */
export function createDefaultDraft(
  overrides: Partial<OrderFormDraft> = {},
): OrderFormDraft {
  return {
    side: "buy",
    type: "market",
    leverage: 1,
    reduceOnly: false,
    ...overrides,
  };
}

/**
 * Flow A — order-book row click -> order-form price.
 *
 * Folds the incoming `{ price }` into the draft (frozen `applyOrderbookPrice`)
 * and switches the order type to `limit`, because a clicked book price is a
 * resting limit price. Leaves side/size/leverage/reduceOnly intact.
 */
export function foldOrderbookPrice(
  draft: OrderFormDraft,
  incoming: OrderDraftPricePayload,
): OrderFormDraft {
  const next = applyOrderbookPrice(draft, incoming);
  return { ...draft, ...next, type: "limit" };
}

/**
 * Flow B — leverage-slider change -> broadcast + local fold.
 *
 * Returns the `trade.leverage` broadcast payload (account-bar + order-form
 * margin preview subscribe) AND the next draft with leverage folded in, using
 * the frozen `applyLeverageChange` reducer.
 */
export function changeLeverage(
  draft: OrderFormDraft,
  leverage: number,
): { payload: LeveragePayload; draft: OrderFormDraft } {
  const { payload, draft: nextBase } = applyLeverageChange(draft, leverage);
  return { payload, draft: { ...draft, ...nextBase } };
}

/** Buy/sell tab toggle. */
export function setSide(
  draft: OrderFormDraft,
  side: OrderSide,
): OrderFormDraft {
  return { ...draft, side };
}

/** market/limit tab toggle. Clearing to market drops the (now-unused) price. */
export function setOrderType(
  draft: OrderFormDraft,
  type: OrderType,
): OrderFormDraft {
  if (type === "market") {
    const { price: _price, ...rest } = draft;
    return { ...rest, type };
  }
  return { ...draft, type };
}

/** Size input. Non-finite/negative sizes clamp to `undefined` (empty). */
export function setSize(
  draft: OrderFormDraft,
  size: number | undefined,
): OrderFormDraft {
  if (size === undefined || !Number.isFinite(size) || size <= 0) {
    const { size: _size, ...rest } = draft;
    return { ...rest };
  }
  return { ...draft, size };
}

/** Reduce-only toggle. */
export function setReduceOnly(
  draft: OrderFormDraft,
  reduceOnly: boolean,
): OrderFormDraft {
  return { ...draft, reduceOnly };
}

/**
 * The submit guard: a market order needs a positive size; a limit order needs
 * both a positive size and a price. Returns false for anything unsubmittable so
 * the button can disable and `toPlaceOrderInput` never builds an invalid input.
 */
export function isDraftSubmittable(draft: OrderFormDraft): boolean {
  if (draft.size === undefined || draft.size <= 0) return false;
  if (draft.type === "limit" && (draft.price === undefined || draft.price <= 0))
    return false;
  return true;
}

/**
 * Projects the local draft onto the frozen `PlaceOrderInput` mutation contract.
 * Throws when the draft is not submittable (callers gate on
 * `isDraftSubmittable` first). Market orders omit `price`; limit orders include
 * it. `reduceOnly` is passed through.
 */
export function toPlaceOrderInput(
  symbol: string,
  draft: OrderFormDraft,
): PlaceOrderInput {
  if (!isDraftSubmittable(draft)) {
    throw new Error("order-form: draft is not submittable");
  }
  const input: PlaceOrderInput = {
    symbol,
    side: draft.side,
    type: draft.type,
    // `size` is guaranteed defined by `isDraftSubmittable`.
    size: draft.size as number,
    leverage: draft.leverage,
    reduceOnly: draft.reduceOnly,
  };
  if (draft.type === "limit") input.price = draft.price;
  return input;
}
