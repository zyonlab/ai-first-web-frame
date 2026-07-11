import { validateInteractionPayload } from "@mvp/interaction";
import {
  type HoveredPricePayload,
  type OrderDraftPricePayload,
  TRADE_HOVERED_PRICE,
  TRADE_ORDER_DRAFT_PRICE,
  tradeSliceContracts,
} from "@mvp/trade-contracts";
import type { OrderbookL2Frame } from "@mvp/trade-data";
import {
  buildLadder,
  diffLadder,
  type Ladder,
  type LadderPatchSet,
} from "./ladder";

/**
 * Vanilla (non-React) patch-only client for the order-book island.
 *
 * P2 ships the *pure logic only*: given a new realtime frame it computes the
 * DOM patch instructions (reusing the shared `ladder` module), and it derives
 * the interaction payloads a row click / hover must publish, validated against
 * the frozen C3 contracts. The real browser subscription + DOM application is
 * exercised in P3/e2e; here we keep the transforms deterministic and testable
 * with no React and no bundler-visible React import (protects the JS budget).
 */

/**
 * CSS class names the patch applies in the browser (P3). Declared here so the
 * scoped stylesheet's rules are referenced from source (the css-budget audit
 * treats never-referenced classes as unused bytes).
 */
export const OB_CLASSES = {
  row: "ob-row",
  bid: "ob-bid",
  ask: "ob-ask",
  price: "ob-price",
  num: "ob-num",
  chip: "ob-chip",
  chipActive: "is-active",
  flashBid: "is-flash-bid",
  flashAsk: "is-flash-ask",
} as const;

/** Contract lookup: the C3 order-book publisher contracts. */
const ORDER_DRAFT_PRICE_CONTRACT = tradeSliceContracts.find(
  (c) => c.channel === TRADE_ORDER_DRAFT_PRICE,
);
const HOVERED_PRICE_CONTRACT = tradeSliceContracts.find(
  (c) => c.channel === TRADE_HOVERED_PRICE,
);

/** A publishable interaction message (channel + validated payload). */
export type Publish<TPayload> = { channel: string; payload: TPayload };

/**
 * Row click → the price the order-form should adopt as its limit price.
 * Payload is validated against the C3 `trade.order-draft.price` schema so an
 * invalid price never reaches the bus.
 */
export function priceDraftFromClick(
  price: number,
): Publish<OrderDraftPricePayload> {
  const payload: OrderDraftPricePayload = { price };
  validateInteractionPayload(
    ORDER_DRAFT_PRICE_CONTRACT?.payloadSchema,
    payload,
    `${TRADE_ORDER_DRAFT_PRICE} publish`,
  );
  return { channel: TRADE_ORDER_DRAFT_PRICE, payload };
}

/**
 * Hover → hovered price guide (or `null` to clear on mouse-leave). Validated
 * against the C3 `trade.hovered-price` schema.
 */
export function hoveredPriceFromHover(
  price: number | null,
): Publish<HoveredPricePayload> {
  const payload: HoveredPricePayload = { price };
  validateInteractionPayload(
    HOVERED_PRICE_CONTRACT?.payloadSchema,
    payload,
    `${TRADE_HOVERED_PRICE} publish`,
  );
  return { channel: TRADE_HOVERED_PRICE, payload };
}

/**
 * Reads the numeric price from a clicked/hovered row element's `data-price`
 * cell. Returns `null` when the element is not (inside) a ladder row.
 */
export function priceFromRowElement(el: Element | null): number | null {
  const row = el?.closest?.("[data-price]") ?? null;
  if (!row) return null;
  const priceCell = row.querySelector?.('[data-field="price"]');
  const raw = priceCell?.getAttribute?.("data-value");
  const price = Number(raw);
  return Number.isFinite(price) ? price : null;
}

/**
 * The pure realtime step: given the previously rendered ladder and a new L2
 * frame (+ depth), compute the next ladder and the patch set to apply. Callers
 * keep `next` as the new `prev` for the following frame.
 */
export function nextPatch(
  prev: Ladder,
  frame: OrderbookL2Frame,
  depth: number,
): { ladder: Ladder; patch: LadderPatchSet } {
  const next = buildLadder(frame, depth);
  return { ladder: next, patch: diffLadder(prev, next) };
}

/** Rebuilds the ladder from an SSR snapshot frame (island resume point). */
export function ladderFromFrame(
  frame: OrderbookL2Frame,
  depth: number,
): Ladder {
  return buildLadder(frame, depth);
}
