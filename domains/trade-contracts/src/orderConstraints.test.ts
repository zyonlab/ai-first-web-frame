import { describe, expect, it } from "vitest";
import {
  assertOrderAgainstSymbol,
  countDecimals,
  isMultipleOf,
  type LeverageLadder,
  OrderConstraintError,
  type OrderConstraintInput,
  type SymbolConstraints,
  tierForNotional,
  validateOrderAgainstSymbol,
} from "./orderConstraints";

/** BTC-like instrument: 0.5 tick, 0.001 lot, 2/3 decimals, 50x cap. */
const BTC: SymbolConstraints = {
  symbol: "BTC",
  tickSize: 0.5,
  lotSize: 0.001,
  priceDecimals: 2,
  sizeDecimals: 3,
  maxLeverage: 50,
};

const LADDER: LeverageLadder = {
  symbol: "BTC",
  tiers: [
    { maxLeverage: 50, maxNotional: 50_000, maintenanceMarginRate: 0.005 },
    { maxLeverage: 20, maxNotional: 250_000, maintenanceMarginRate: 0.01 },
    { maxLeverage: 5, maxNotional: 1_000_000, maintenanceMarginRate: 0.025 },
  ],
};

const limit = (
  over: Partial<OrderConstraintInput> = {},
): OrderConstraintInput => ({
  symbol: "BTC",
  side: "buy",
  type: "limit",
  size: 0.01,
  price: 63_000.5,
  leverage: 10,
  ...over,
});

const codes = (order: OrderConstraintInput, options = {}) =>
  validateOrderAgainstSymbol(order, BTC, options).violations.map((v) => v.code);

describe("decimal arithmetic (why this module is not `%`)", () => {
  it("counts decimals, including exponential notation", () => {
    expect(countDecimals(1.23)).toBe(2);
    expect(countDecimals(5)).toBe(0);
    expect(countDecimals(1.23e-8)).toBe(10);
    expect(countDecimals(0.001)).toBe(3);
    // Trailing zeros are not precision.
    expect(countDecimals(1.2300000000000002)).toBeGreaterThan(2);
  });

  it("answers divisibility where float modulo does not", () => {
    // The motivating case: `0.3 % 0.1` is 0.09999999999999998, not 0.
    expect(0.3 % 0.1).not.toBe(0);
    expect(isMultipleOf(0.3, 0.1, 3)).toBe(true);
    expect(isMultipleOf(0.007, 0.001, 3)).toBe(true);
    expect(isMultipleOf(0.0015, 0.001, 4)).toBe(false);
    // Regression: scaling only to the DECLARED precision rounds 0.0015 into
    // the 0.001 grid and reports an off-grid size as valid. The scale must
    // cover the value's own precision.
    expect(isMultipleOf(0.0015, 0.001, 3)).toBe(false);
    expect(isMultipleOf(0.0025, 0.002, 3)).toBe(false);
    expect(isMultipleOf(63_000.5, 0.5, 2)).toBe(true);
    expect(isMultipleOf(63_000.3, 0.5, 2)).toBe(false);
  });

  it("refuses a non-positive or non-finite step rather than dividing by it", () => {
    expect(isMultipleOf(1, 0, 2)).toBe(false);
    expect(isMultipleOf(1, -0.1, 2)).toBe(false);
    expect(isMultipleOf(Number.NaN, 0.1, 2)).toBe(false);
  });
});

describe("validateOrderAgainstSymbol", () => {
  it("accepts a well-formed limit order", () => {
    const result = validateOrderAgainstSymbol(limit(), BTC, { ladder: LADDER });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.notional).toBeCloseTo(630.005, 5);
    expect(result.unchecked).toEqual([]);
  });

  it("rejects a price off the tick grid", () => {
    expect(codes(limit({ price: 63_000.3 }))).toContain(
      "price-not-multiple-of-tick",
    );
  });

  it("rejects a size that is not a whole number of lots", () => {
    expect(codes(limit({ size: 0.0015 }))).toContain(
      "size-not-multiple-of-lot",
    );
  });

  it("rejects more decimal places than the instrument publishes", () => {
    const result = validateOrderAgainstSymbol(
      limit({ size: 0.00015, price: 63_000.555 }),
      BTC,
    );
    const found = result.violations.map((v) => v.code);
    expect(found).toContain("size-precision-exceeded");
    expect(found).toContain("price-precision-exceeded");
  });

  it("rejects a size below the minimum, honouring minOrderSize over lotSize", () => {
    // Step 0.001 but minimum 0.01 — the two are different on most venues.
    const withMinimum: SymbolConstraints = { ...BTC, minOrderSize: 0.01 };
    const result = validateOrderAgainstSymbol(
      limit({ size: 0.005 }),
      withMinimum,
    );
    const violation = result.violations.find(
      (v) => v.code === "size-below-minimum",
    );
    expect(violation?.limit).toBe(0.01);
    // …and the same order passes when only the step applies.
    expect(codes(limit({ size: 0.005 }))).not.toContain("size-below-minimum");
  });

  it("requires a price on a limit order and forbids one on a market order", () => {
    expect(codes(limit({ price: undefined }))).toContain(
      "limit-price-required",
    );
    expect(codes(limit({ type: "market", price: 63_000.5 }))).toContain(
      "market-order-price-not-allowed",
    );
  });

  it("enforces the instrument leverage ceiling", () => {
    expect(codes(limit({ leverage: 75 }))).toContain(
      "leverage-above-symbol-max",
    );
    expect(codes(limit({ leverage: 0 }))).toContain("leverage-not-positive");
  });

  it("narrows leverage by the margin ladder tier the notional falls in", () => {
    // 2 BTC @ 63,000.5 = 126,001 notional → the 250k tier, capped at 20x.
    const big = limit({ size: 2, leverage: 30 });
    const result = validateOrderAgainstSymbol(big, BTC, { ladder: LADDER });
    const violation = result.violations.find(
      (v) => v.code === "leverage-above-tier-max",
    );
    expect(violation?.limit).toBe(20);
    // 20x at the same notional is fine, even though the instrument allows 50x.
    expect(
      validateOrderAgainstSymbol({ ...big, leverage: 20 }, BTC, {
        ladder: LADDER,
      }).ok,
    ).toBe(true);
  });

  it("rejects a notional above the largest tier", () => {
    const huge = limit({ size: 100, leverage: 2 });
    const result = validateOrderAgainstSymbol(huge, BTC, { ladder: LADDER });
    const violation = result.violations.find(
      (v) => v.code === "notional-above-max-tier",
    );
    expect(violation?.limit).toBe(1_000_000);
  });

  it("catches constraints belonging to a different symbol", () => {
    // A stale symbol.meta after a switch would validate ETH against BTC's grid.
    expect(codes({ ...limit(), symbol: "ETH" })).toContain("symbol-mismatch");
  });

  it("reports unchecked rules instead of passing them silently", () => {
    const market = limit({ type: "market", price: undefined });
    const noPrice = validateOrderAgainstSymbol(market, BTC, { ladder: LADDER });
    expect(noPrice.ok).toBe(true);
    expect(noPrice.notional).toBeUndefined();
    expect(noPrice.unchecked.join()).toContain("referencePrice");

    // With a reference price the tier rules DO run for a market order.
    const valued = validateOrderAgainstSymbol(
      { ...market, size: 2, leverage: 30 },
      BTC,
      {
        ladder: LADDER,
        referencePrice: 63_000,
      },
    );
    expect(valued.violations.map((v) => v.code)).toContain(
      "leverage-above-tier-max",
    );

    // No ladder at all is also said out loud.
    expect(validateOrderAgainstSymbol(limit(), BTC).unchecked.join()).toContain(
      "no leverage ladder",
    );
  });

  it("collects every violation in one pass, not just the first", () => {
    const bad = limit({ size: 0.0015, price: 63_000.3, leverage: 99 });
    const result = validateOrderAgainstSymbol(bad, BTC, { ladder: LADDER });
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
  });
});

describe("tierForNotional", () => {
  it("picks the first rung that covers the notional, regardless of input order", () => {
    const shuffled: LeverageLadder = {
      symbol: "BTC",
      tiers: [LADDER.tiers[2], LADDER.tiers[0], LADDER.tiers[1]],
    };
    expect(tierForNotional(shuffled, 10_000)?.maxLeverage).toBe(50);
    expect(tierForNotional(shuffled, 100_000)?.maxLeverage).toBe(20);
    expect(tierForNotional(shuffled, 900_000)?.maxLeverage).toBe(5);
    expect(tierForNotional(shuffled, 2_000_000)).toBeUndefined();
  });

  it("treats the boundary as inclusive", () => {
    expect(tierForNotional(LADDER, 50_000)?.maxLeverage).toBe(50);
    expect(tierForNotional(LADDER, 50_000.01)?.maxLeverage).toBe(20);
  });
});

describe("assertOrderAgainstSymbol", () => {
  it("throws a typed error carrying every violation", () => {
    try {
      assertOrderAgainstSymbol(limit({ price: 63_000.3, leverage: 99 }), BTC);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OrderConstraintError);
      const typed = error as OrderConstraintError;
      expect(typed.name).toBe("OrderConstraintError");
      expect(typed.violations.length).toBe(2);
      expect(typed.message).toContain("+1 more");
    }
  });

  it("is silent for a valid order", () => {
    expect(() =>
      assertOrderAgainstSymbol(limit(), BTC, { ladder: LADDER }),
    ).not.toThrow();
  });
});
