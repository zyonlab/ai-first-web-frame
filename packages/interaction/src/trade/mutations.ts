import { defineMutation, type Mutation } from "../index";
import type { OrderSide } from "./slices";

/**
 * Trade-demo mutation contracts (data doc 03 §6).
 *
 * Execution is **mock** (a seeded, deterministic fill/ack injected at the call
 * site), but the contract — declared invalidation tags, undeclared-tag
 * rejection, input validation — is real and reuses the frozen `defineMutation`
 * guarantee from the interaction core (undeclared tags throw
 * `MutationContractError` before any invalidation runs).
 *
 * The declared `invalidates` tags mirror the `createDataKey` partitions / the
 * A1-data source `invalidationTags` (data doc §1c, §4.3): `orders:{user}`,
 * `positions:{user}`, `account:{user}`, `balances:{user}`. `{user}` is a
 * placeholder resolved to `ctx.user.id` at call time.
 */

export type PlaceOrderInput = {
  symbol: string;
  side: OrderSide;
  type: "market" | "limit";
  size: number;
  /** Required for limit orders; validated in the injected `mutate`. */
  price?: number;
  leverage: number;
  reduceOnly?: boolean;
};

export type PlaceOrderResult = {
  orderId: string;
  status: "accepted" | "filled";
};

/** Tag templates a place-order is EVER allowed to invalidate. */
export const PLACE_ORDER_INVALIDATES = [
  "orders:{user}",
  "positions:{user}",
  "account:{user}",
  "balances:{user}",
] as const;

export const placeOrder: Mutation<PlaceOrderInput, PlaceOrderResult> =
  defineMutation<PlaceOrderInput, PlaceOrderResult>({
    name: "trade.place-order",
    input: {
      type: "object",
      required: ["symbol", "side", "type", "size", "leverage"],
      additionalProperties: false,
      properties: {
        symbol: { type: "string" },
        side: { type: "string", enum: ["buy", "sell"] },
        type: { type: "string", enum: ["market", "limit"] },
        size: { type: "number" },
        price: { type: "number" },
        leverage: { type: "number" },
        reduceOnly: { type: "boolean" },
      },
    },
    invalidates: [...PLACE_ORDER_INVALIDATES],
  });

export type CancelOrderInput = { orderId: string; symbol: string };
export type CancelOrderResult = { orderId: string; status: "cancelled" };

/** Cancel only touches working orders. */
export const CANCEL_ORDER_INVALIDATES = ["orders:{user}"] as const;

export const cancelOrder: Mutation<CancelOrderInput, CancelOrderResult> =
  defineMutation<CancelOrderInput, CancelOrderResult>({
    name: "trade.cancel-order",
    input: {
      type: "object",
      required: ["orderId", "symbol"],
      additionalProperties: false,
      properties: {
        orderId: { type: "string" },
        symbol: { type: "string" },
      },
    },
    invalidates: [...CANCEL_ORDER_INVALIDATES],
  });

/**
 * Resolves `{user}` placeholders in a mutation's declared tag templates to a
 * concrete user id, matching the `createDataKey` user partition (data doc §4.3).
 *
 * IMPORTANT: resolve inside the `io.invalidate` handler, NOT in
 * `execute(..., { invalidates })`. The undeclared-tag guard does a literal
 * membership check against the declared templates, so a resolved tag
 * (`orders:u1`) is NOT a member of `["orders:{user}"]` and would be rejected.
 * Call `execute` with no `options.invalidates` (uses the declared templates),
 * and in the injected `invalidate` handler map them through `resolveUserTags`
 * before calling `dataClient.mutateData(...)`:
 *
 *   placeOrder.execute(input, {
 *     mutate,
 *     invalidate: (tags) => dataClient.mutateData(resolveUserTags(tags, ctx.user.id)),
 *   });
 */
export function resolveUserTags(
  templates: readonly string[],
  userId: string,
): string[] {
  return templates.map((tag) => tag.replace("{user}", userId));
}

/**
 * Mock deterministic matching engine used by the demo. A real one would live in
 * a server function; here it produces a seeded, reproducible ack so tests and
 * the demo recording are stable. Kept pure (no I/O) — it is passed as
 * `io.mutate`.
 */
export function createMockMatchingEngine(seed = 1): {
  place: (input: PlaceOrderInput) => PlaceOrderResult;
  cancel: (input: CancelOrderInput) => CancelOrderResult;
} {
  let counter = seed;
  const nextId = (prefix: string) => {
    counter += 1;
    return `${prefix}-${counter.toString(36)}`;
  };
  return {
    place: (input) => ({
      orderId: nextId("ord"),
      // Market orders fill immediately; limit orders are accepted (resting).
      status: input.type === "market" ? "filled" : "accepted",
    }),
    cancel: (input) => ({ orderId: input.orderId, status: "cancelled" }),
  };
}
