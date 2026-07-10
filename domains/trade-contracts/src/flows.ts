import type {
  ActiveSymbolPayload,
  LeveragePayload,
  OrderDraftPayload,
  OrderDraftPricePayload,
} from "./slices";

/**
 * Pure reducers for the three canonical store data flows (spine §7 / data doc
 * 03 §5.3). None of these touch the DOM — they are the deterministic core an
 * island wires to an event (a click / a slider drag / a palette pick) and then
 * publishes on the bus. Tests drive them with `createSliceStore` + an in-memory
 * bus to prove each flow updates only its target slice.
 */

/**
 * Flow A — order-book row click -> order-form price.
 *
 * The order-book publishes only `{ price }` on the fast-path
 * `trade.order-draft.price` channel (it may not write the full draft). The
 * order-form folds the incoming price into its local draft and re-emits the
 * full `trade.order-draft`. This reducer is that fold: it returns the next
 * draft with the price applied, leaving side/size/leverage/reduceOnly intact.
 */
export function applyOrderbookPrice(
  draft: OrderDraftPayload,
  incoming: OrderDraftPricePayload,
): OrderDraftPayload {
  return { ...draft, price: incoming.price };
}

/**
 * Flow B — leverage slider change -> broadcast.
 *
 * The order-form owns leverage; a slider change produces the leverage payload
 * to broadcast on `trade.leverage` (account-bar + order-form margin preview
 * subscribe). It also folds into the local draft so the draft's leverage stays
 * consistent. Returns both the broadcast payload and the next draft.
 */
export function applyLeverageChange(
  draft: OrderDraftPayload,
  leverage: number,
): { payload: LeveragePayload; draft: OrderDraftPayload } {
  return {
    payload: { leverage },
    draft: { ...draft, leverage },
  };
}

/**
 * Flow C — symbol switch -> activeSymbol.
 *
 * The symbol-switcher publishes the new active symbol; this reducer produces
 * the `trade.active-symbol` payload. Kept trivial/pure so the flow test asserts
 * that publishing it updates ONLY the activeSymbol slice (chart/book/form
 * resubscribe off it; the shell subscribes to none of these channels).
 */
export function applySymbolSwitch(symbol: string): ActiveSymbolPayload {
  return { symbol };
}
