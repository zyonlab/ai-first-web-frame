import {
  type LeverageLadder,
  OrderConstraintError,
  type PlaceOrderInput,
  type SymbolConstraints,
} from "@mvp/trade-contracts";
import { describe, expect, it, vi } from "vitest";
import { submitOrder } from "../src/placeOrderFlow";

/**
 * The submit path must refuse an order that violates the instrument's published
 * limits BEFORE the matching engine sees it. Before this guard, `placeOrder`'s
 * contract validated field types only, so an off-grid price reached the engine
 * with a payload that looked entirely valid.
 */
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
  ],
};

const order = (over: Partial<PlaceOrderInput> = {}): PlaceOrderInput => ({
  symbol: "BTC",
  side: "buy",
  type: "limit",
  size: 0.01,
  price: 63_000.5,
  leverage: 10,
  ...over,
});

function deps(extra: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(async () => ({
      orderId: "o-1",
      status: "accepted" as const,
    })),
    userId: "u1",
    invalidate: vi.fn(),
    ...extra,
  };
}

describe("submitOrder constraint guard", () => {
  it("submits a conforming order and reports that the check ran", async () => {
    const d = deps({ constraints: BTC, ladder: LADDER });
    const outcome = await submitOrder(order(), d);
    expect(outcome.result.orderId).toBe("o-1");
    expect(outcome.constraintsChecked).toBe(true);
    expect(d.mutate).toHaveBeenCalledOnce();
  });

  it("refuses an off-grid price WITHOUT reaching the matching engine", async () => {
    const d = deps({ constraints: BTC });
    await expect(
      submitOrder(order({ price: 63_000.3 }), d),
    ).rejects.toBeInstanceOf(OrderConstraintError);
    // The point of validating before execute: nothing was submitted.
    expect(d.mutate).not.toHaveBeenCalled();
    expect(d.invalidate).not.toHaveBeenCalled();
  });

  it("refuses leverage above the tier ceiling for the order's notional", async () => {
    // 2 BTC @ 63,000.5 = 126,001 → the 250k tier, capped at 20x.
    const d = deps({ constraints: BTC, ladder: LADDER });
    const error: OrderConstraintError = await submitOrder(
      order({ size: 2, leverage: 30 }),
      d,
    ).then(
      () => {
        throw new Error("should have been rejected");
      },
      (e: unknown) => e as OrderConstraintError,
    );
    expect(error.violations.map((v) => v.code)).toContain(
      "leverage-above-tier-max",
    );
    expect(d.mutate).not.toHaveBeenCalled();
  });

  it("surfaces every violation at once so the form can show them together", async () => {
    const d = deps({ constraints: BTC });
    const error: OrderConstraintError = await submitOrder(
      order({ size: 0.0015, price: 63_000.3, leverage: 99 }),
      d,
    ).then(
      () => {
        throw new Error("should have been rejected");
      },
      (e: unknown) => e as OrderConstraintError,
    );
    expect(error.violations.length).toBeGreaterThanOrEqual(3);
  });

  it("says plainly when NO check ran rather than implying one did", async () => {
    const d = deps(); // no constraints supplied
    const outcome = await submitOrder(order({ price: 63_000.3 }), d);
    expect(outcome.constraintsChecked).toBe(false);
    expect(d.mutate).toHaveBeenCalledOnce();
  });
});
