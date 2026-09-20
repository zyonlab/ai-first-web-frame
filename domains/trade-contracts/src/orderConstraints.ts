/**
 * Order-constraint validation — the enforcement point the trading contracts
 * were missing.
 *
 * `symbol.meta.<sym>` and `leverage.tiers.<sym>` already publish tick size, lot
 * size, decimal precision, max leverage and the margin ladder. Nothing consumed
 * them as RULES: `placeOrder`'s contract validates field *types* (is `size` a
 * number) and stops there, so an order with a price off the tick grid, a size
 * that is not a whole number of lots, or leverage above the tier ceiling passed
 * the contract and failed — or worse, did not fail — at the exchange.
 *
 * Everything here is pure and side-effect free so the same function runs in the
 * island before submit and on the server before execution. Re-validating on the
 * server is not optional: the browser copy can be bypassed.
 *
 * ## Why the arithmetic looks paranoid
 *
 * Order sizes and prices are decimal quantities carried in binary floats.
 * `0.1 + 0.2 !== 0.3`, and `0.3 % 0.1` is `0.09999999999999998`, not `0`. A
 * naive `size % lotSize === 0` therefore rejects valid orders and (with other
 * values) accepts invalid ones. Every comparison below scales to integers using
 * the instrument's own declared decimal precision before testing divisibility.
 */

/**
 * The instrument limits this module needs. Declared structurally rather than
 * imported from `@mvp/trade-data` so the contract layer stays a leaf: the
 * `SymbolMetadata` that data layer publishes satisfies this shape as-is.
 */
export type SymbolConstraints = {
  symbol: string;
  /** Minimum price increment. */
  tickSize: number;
  /** Minimum size increment (quantity step). */
  lotSize: number;
  /** Maximum decimal places a price may carry. */
  priceDecimals: number;
  /** Maximum decimal places a size may carry. */
  sizeDecimals: number;
  /** Instrument-wide leverage ceiling, before the tier ladder narrows it. */
  maxLeverage: number;
  /**
   * Smallest tradable size, when it differs from the quantity step. Most venues
   * publish these separately (step 0.001 but minimum 0.01); when absent,
   * `lotSize` is used, which is the conservative reading.
   */
  minOrderSize?: number;
};

/** One rung of the margin ladder. */
export type LeverageLadderTier = {
  maxLeverage: number;
  maxNotional: number;
  maintenanceMarginRate: number;
};

export type LeverageLadder = { symbol: string; tiers: LeverageLadderTier[] };

/** The order fields these rules apply to. */
export type OrderConstraintInput = {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  size: number;
  price?: number;
  leverage: number;
  reduceOnly?: boolean;
};

export type OrderViolationCode =
  | "symbol-mismatch"
  | "size-not-positive"
  | "size-below-minimum"
  | "size-not-multiple-of-lot"
  | "size-precision-exceeded"
  | "limit-price-required"
  | "price-not-positive"
  | "price-not-multiple-of-tick"
  | "price-precision-exceeded"
  | "market-order-price-not-allowed"
  | "leverage-not-positive"
  | "leverage-above-symbol-max"
  | "leverage-above-tier-max"
  | "notional-above-max-tier";

export type OrderViolation = {
  code: OrderViolationCode;
  field: "symbol" | "size" | "price" | "leverage" | "notional";
  message: string;
  /** The offending value, when numeric. */
  actual?: number;
  /** The limit it violated, when numeric. */
  limit?: number;
};

export type OrderValidation = {
  ok: boolean;
  violations: OrderViolation[];
  /**
   * Rules that could NOT be evaluated with the inputs given, named explicitly.
   * A market order with no reference price cannot have its notional checked —
   * saying so is the difference between "passed" and "never looked".
   */
  unchecked: string[];
  /** Notional (size x price) when it could be computed. */
  notional?: number;
};

export type ValidateOrderOptions = {
  /** Margin ladder for the instrument; tier rules are skipped when absent. */
  ladder?: LeverageLadder;
  /**
   * Price to value a MARKET order at (mark/last). Limit orders use their own
   * price. Without it a market order's notional and tier rules are unchecked.
   */
  referencePrice?: number;
};

/** Decimal places carried by a finite number (`1.230` → 2, `5` → 0). */
export function countDecimals(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // Exponential notation (1e-8) has no fractional part in its string form.
  const text = Math.abs(value).toExponential();
  const [mantissa, exponent] = text.split("e");
  const mantissaDecimals = (mantissa.split(".")[1] ?? "").replace(
    /0+$/,
    "",
  ).length;
  return Math.max(0, mantissaDecimals - Number(exponent));
}

/**
 * Whether `value` is a whole number of `step`s, compared as integers. Float
 * modulo cannot answer this: `0.3 % 0.1` is `0.09999999999999998`.
 *
 * The scale must cover the VALUE's own precision, not just the step's and the
 * instrument's. Scaling only to the declared precision rounds away exactly the
 * part that makes a value non-conforming: `0.0015` at 3 declared decimals
 * scales to `round(1.5) = 2`, which divides cleanly by a lot of `1` and reports
 * an off-grid size as valid. `decimals` is therefore a floor, not the answer.
 */
export function isMultipleOf(
  value: number,
  step: number,
  decimals: number,
): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return false;
  }
  const scale =
    10 ** Math.max(decimals, countDecimals(step), countDecimals(value));
  const scaledValue = Math.round(value * scale);
  const scaledStep = Math.round(step * scale);
  if (scaledStep === 0) return false;
  return scaledValue % scaledStep === 0;
}

/** The ladder rung governing a notional, or undefined when it exceeds them all. */
export function tierForNotional(
  ladder: LeverageLadder,
  notional: number,
): LeverageLadderTier | undefined {
  return [...ladder.tiers]
    .sort((a, b) => a.maxNotional - b.maxNotional)
    .find((tier) => notional <= tier.maxNotional);
}

/**
 * Validates one order against its instrument's published limits.
 *
 * Collects EVERY violation rather than failing on the first: a trader fixing a
 * rejected order should see all of what is wrong in one pass.
 */
export function validateOrderAgainstSymbol(
  order: OrderConstraintInput,
  constraints: SymbolConstraints,
  options: ValidateOrderOptions = {},
): OrderValidation {
  const violations: OrderViolation[] = [];
  const unchecked: string[] = [];

  // A stale `symbol.meta` after a symbol switch would otherwise validate an
  // ETH order against BTC's tick grid — silently, and plausibly.
  if (order.symbol !== constraints.symbol) {
    violations.push({
      code: "symbol-mismatch",
      field: "symbol",
      message: `order is for ${order.symbol} but the constraints are for ${constraints.symbol}`,
    });
  }

  // ── size ──
  if (!Number.isFinite(order.size) || order.size <= 0) {
    violations.push({
      code: "size-not-positive",
      field: "size",
      message: "size must be greater than zero",
      actual: order.size,
    });
  } else {
    const minimum = constraints.minOrderSize ?? constraints.lotSize;
    if (order.size < minimum) {
      violations.push({
        code: "size-below-minimum",
        field: "size",
        message: `size ${order.size} is below the minimum order size ${minimum}`,
        actual: order.size,
        limit: minimum,
      });
    }
    if (countDecimals(order.size) > constraints.sizeDecimals) {
      violations.push({
        code: "size-precision-exceeded",
        field: "size",
        message: `size ${order.size} carries more than ${constraints.sizeDecimals} decimal places`,
        actual: countDecimals(order.size),
        limit: constraints.sizeDecimals,
      });
    }
    if (
      !isMultipleOf(order.size, constraints.lotSize, constraints.sizeDecimals)
    ) {
      violations.push({
        code: "size-not-multiple-of-lot",
        field: "size",
        message: `size ${order.size} is not a whole number of ${constraints.lotSize} lots`,
        actual: order.size,
        limit: constraints.lotSize,
      });
    }
  }

  // ── price ──
  if (order.type === "limit") {
    if (order.price === undefined) {
      violations.push({
        code: "limit-price-required",
        field: "price",
        message: "a limit order requires a price",
      });
    } else if (!Number.isFinite(order.price) || order.price <= 0) {
      violations.push({
        code: "price-not-positive",
        field: "price",
        message: "price must be greater than zero",
        actual: order.price,
      });
    } else {
      if (countDecimals(order.price) > constraints.priceDecimals) {
        violations.push({
          code: "price-precision-exceeded",
          field: "price",
          message: `price ${order.price} carries more than ${constraints.priceDecimals} decimal places`,
          actual: countDecimals(order.price),
          limit: constraints.priceDecimals,
        });
      }
      if (
        !isMultipleOf(
          order.price,
          constraints.tickSize,
          constraints.priceDecimals,
        )
      ) {
        violations.push({
          code: "price-not-multiple-of-tick",
          field: "price",
          message: `price ${order.price} is not aligned to the ${constraints.tickSize} tick grid`,
          actual: order.price,
          limit: constraints.tickSize,
        });
      }
    }
  } else if (order.price !== undefined) {
    // A market order carrying a price is a UI wiring bug, and a dangerous one:
    // it reads as a limit the venue will not honor.
    violations.push({
      code: "market-order-price-not-allowed",
      field: "price",
      message: "a market order must not carry a price",
      actual: order.price,
    });
  }

  // ── leverage ──
  if (!Number.isFinite(order.leverage) || order.leverage <= 0) {
    violations.push({
      code: "leverage-not-positive",
      field: "leverage",
      message: "leverage must be greater than zero",
      actual: order.leverage,
    });
  } else if (order.leverage > constraints.maxLeverage) {
    violations.push({
      code: "leverage-above-symbol-max",
      field: "leverage",
      message: `leverage ${order.leverage}x exceeds the instrument maximum ${constraints.maxLeverage}x`,
      actual: order.leverage,
      limit: constraints.maxLeverage,
    });
  }

  // ── notional + margin ladder ──
  const valuationPrice =
    order.type === "limit" ? order.price : options.referencePrice;
  const sizeUsable = Number.isFinite(order.size) && order.size > 0;
  let notional: number | undefined;
  if (valuationPrice !== undefined && valuationPrice > 0 && sizeUsable) {
    notional = order.size * valuationPrice;
  } else if (sizeUsable) {
    unchecked.push(
      order.type === "market"
        ? "notional/tier rules: a market order needs options.referencePrice"
        : "notional/tier rules: no usable price",
    );
  }

  if (options.ladder === undefined) {
    unchecked.push("tier rules: no leverage ladder supplied");
  } else if (notional !== undefined) {
    const tier = tierForNotional(options.ladder, notional);
    if (!tier) {
      const ceiling = Math.max(
        ...options.ladder.tiers.map((item) => item.maxNotional),
      );
      violations.push({
        code: "notional-above-max-tier",
        field: "notional",
        message: `notional ${notional} exceeds the largest tier's ${ceiling}`,
        actual: notional,
        limit: ceiling,
      });
    } else if (
      Number.isFinite(order.leverage) &&
      order.leverage > tier.maxLeverage
    ) {
      violations.push({
        code: "leverage-above-tier-max",
        field: "leverage",
        message: `leverage ${order.leverage}x exceeds ${tier.maxLeverage}x allowed at a notional of ${notional}`,
        actual: order.leverage,
        limit: tier.maxLeverage,
      });
    }
  }

  return { ok: violations.length === 0, violations, unchecked, notional };
}

/** Thrown by {@link assertOrderAgainstSymbol}; carries every violation. */
export class OrderConstraintError extends Error {
  readonly violations: OrderViolation[];
  readonly unchecked: string[];

  constructor(validation: OrderValidation) {
    const first = validation.violations[0];
    super(
      `order violates instrument constraints${first ? `: ${first.message}` : ""}${
        validation.violations.length > 1
          ? ` (+${validation.violations.length - 1} more)`
          : ""
      }`,
    );
    this.name = "OrderConstraintError";
    this.violations = validation.violations;
    this.unchecked = validation.unchecked;
  }
}

/**
 * Throwing form for a submit path. Use this at the point of no return (the
 * server mutation); use {@link validateOrderAgainstSymbol} in the UI, where
 * every violation should be shown at once rather than thrown one at a time.
 */
export function assertOrderAgainstSymbol(
  order: OrderConstraintInput,
  constraints: SymbolConstraints,
  options: ValidateOrderOptions = {},
): void {
  const validation = validateOrderAgainstSymbol(order, constraints, options);
  if (!validation.ok) throw new OrderConstraintError(validation);
}
