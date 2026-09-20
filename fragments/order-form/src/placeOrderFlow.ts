import {
  assertOrderAgainstSymbol,
  type LeverageLadder,
  type PlaceOrderInput,
  type PlaceOrderResult,
  placeOrder,
  resolveUserTags,
  type SymbolConstraints,
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
  /**
   * The instrument's published limits (`symbol.meta.<sym>`). When supplied, the
   * order is checked against tick/lot/precision/leverage BEFORE it reaches the
   * matching engine.
   *
   * Optional only so existing callers keep working; a submit path that omits it
   * performs NO constraint check, which is why `submitOrder` reports
   * `constraintsChecked: false` rather than letting the caller assume it did.
   * A real backend must re-validate regardless — the browser copy is bypassable.
   */
  constraints?: SymbolConstraints;
  /** Margin ladder (`leverage.tiers.<sym>`); enables the tier rules. */
  ladder?: LeverageLadder;
  /** Mark/last price, so a MARKET order's notional and tier rules can run. */
  referencePrice?: number;
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
  /** Whether instrument constraints were actually evaluated for this submit. */
  constraintsChecked: boolean;
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
  // Constraint enforcement happens BEFORE the mutation runs: `placeOrder`'s
  // contract validates field types only, so without this an order priced off
  // the tick grid, sized off the lot grid, or levered above the tier ceiling
  // reached the engine with a valid-looking payload.
  //
  // Throws `OrderConstraintError` carrying every violation; the island renders
  // them, and a server-side submit path must call the same assertion.
  if (deps.constraints) {
    assertOrderAgainstSymbol(
      {
        symbol: input.symbol,
        side: input.side,
        type: input.type,
        size: input.size,
        price: input.price,
        leverage: input.leverage,
        reduceOnly: input.reduceOnly,
      },
      deps.constraints,
      { ladder: deps.ladder, referencePrice: deps.referencePrice },
    );
  }

  let resolved: string[] = [];
  const { result, invalidated } = await placeOrder.execute(input, {
    mutate: deps.mutate,
    invalidate: async (tags) => {
      // Resolve `{user}` -> ctx.user.id ONLY here, then invalidate.
      resolved = resolveUserTags(tags, deps.userId);
      await deps.invalidate(resolved);
    },
  });
  return {
    result,
    constraintsChecked: deps.constraints !== undefined,
    invalidated,
    resolved,
  };
}
