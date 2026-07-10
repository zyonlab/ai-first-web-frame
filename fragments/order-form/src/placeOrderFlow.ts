import {
  type PlaceOrderInput,
  type PlaceOrderResult,
  placeOrder,
  resolveUserTags,
} from "@mvp/trade-contracts";

/**
 * The order-form submit flow (mutation contract usage, data doc 03 §6).
 *
 * Wraps `placeOrder.execute` with the *correct* invalidation discipline
 * (mutations.ts warns about this explicitly):
 *
 *  - `execute` is called with NO `options.invalidates`, so it uses the declared
 *    tag *templates* (`orders:{user}`, `positions:{user}`, `account:{user}`,
 *    `balances:{user}`). The undeclared-tag guard is a literal membership check,
 *    so a pre-resolved tag (`orders:u1`) would be rejected.
 *  - `{user}` is resolved to the concrete user id INSIDE the injected
 *    `invalidate` callback via `resolveUserTags(tags, userId)`, then handed to
 *    `dataClient.mutateData(...)`.
 *
 * `mutate` is the injected mock matching engine (`createMockMatchingEngine`) —
 * execution is mock, the contract is real. `invalidate` receives the *resolved*
 * tags (kept as a param so the island can hand them to
 * `client.mutateData(resolved)` and the test can assert them).
 */
export type SubmitOrderDeps = {
  /** The deterministic mock fill/ack (`createMockMatchingEngine().place`). */
  mutate: (
    input: PlaceOrderInput,
  ) => PlaceOrderResult | Promise<PlaceOrderResult>;
  /** The `ctx.user.id` the `{user}` templates resolve against. */
  userId: string;
  /**
   * Invalidates the RESOLVED cache tags (wire to
   * `dataClient.mutateData(resolvedTags)`).
   */
  invalidate: (resolvedTags: string[]) => void | Promise<void>;
};

export type SubmitOrderOutcome = {
  result: PlaceOrderResult;
  /** The declared templates `execute` invalidated (still `{user}`-templated). */
  invalidated: string[];
  /** The tags actually invalidated after `{user}` resolution. */
  resolved: string[];
};

/**
 * Runs the place-order mutation for a submitted draft. Returns the ack plus the
 * templated and resolved invalidation tag sets (for the island toast + tests).
 */
export async function submitOrder(
  input: PlaceOrderInput,
  deps: SubmitOrderDeps,
): Promise<SubmitOrderOutcome> {
  let resolved: string[] = [];
  const { result, invalidated } = await placeOrder.execute(input, {
    mutate: deps.mutate,
    invalidate: async (tags) => {
      // Resolve `{user}` -> ctx.user.id ONLY here, then invalidate.
      resolved = resolveUserTags(tags, deps.userId);
      await deps.invalidate(resolved);
    },
  });
  return { result, invalidated, resolved };
}
