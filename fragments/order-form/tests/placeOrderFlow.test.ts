import {
  createMockMatchingEngine,
  PLACE_ORDER_INVALIDATES,
  type PlaceOrderInput,
} from "@mvp/interaction";
import { describe, expect, it, vi } from "vitest";
import { submitOrder } from "../src/placeOrderFlow";

const marketInput: PlaceOrderInput = {
  symbol: "BTC",
  side: "buy",
  type: "market",
  size: 1,
  leverage: 10,
  reduceOnly: false,
};

describe("placeOrder flow — execute + declared templates + user resolution", () => {
  it("runs the mock matching engine and returns a filled ack for a market order", async () => {
    const engine = createMockMatchingEngine(1);
    const invalidate = vi.fn();
    const outcome = await submitOrder(marketInput, {
      mutate: engine.place,
      userId: "u1",
      invalidate,
    });
    expect(outcome.result.status).toBe("filled");
    expect(outcome.result.orderId).toMatch(/^ord-/);
  });

  it("invalidates the DECLARED templates (still {user}-templated at execute)", async () => {
    const engine = createMockMatchingEngine();
    const outcome = await submitOrder(marketInput, {
      mutate: engine.place,
      userId: "u1",
      invalidate: () => {},
    });
    // execute() used the declared templates (no options.invalidates).
    expect(outcome.invalidated).toEqual([...PLACE_ORDER_INVALIDATES]);
    expect(outcome.invalidated).toContain("orders:{user}");
  });

  it("resolves {user} to the concrete user id INSIDE the invalidate callback", async () => {
    const engine = createMockMatchingEngine();
    const invalidate = vi.fn();
    const outcome = await submitOrder(marketInput, {
      mutate: engine.place,
      userId: "user-42",
      invalidate,
    });
    const expected = [
      "orders:user-42",
      "positions:user-42",
      "account:user-42",
      "balances:user-42",
    ];
    // The callback received the RESOLVED tags (not the templates).
    expect(invalidate).toHaveBeenCalledWith(expected);
    expect(outcome.resolved).toEqual(expected);
    // And no template leaked through as a resolved tag.
    expect(outcome.resolved.some((t) => t.includes("{user}"))).toBe(false);
  });

  it("awaits an async invalidate (wire to dataClient.mutateData)", async () => {
    const engine = createMockMatchingEngine();
    const calls: string[][] = [];
    await submitOrder(marketInput, {
      mutate: engine.place,
      userId: "u9",
      invalidate: async (tags) => {
        await Promise.resolve();
        calls.push(tags);
      },
    });
    expect(calls).toEqual([
      ["orders:u9", "positions:u9", "account:u9", "balances:u9"],
    ]);
  });

  it("a limit order is accepted (resting), not filled", async () => {
    const engine = createMockMatchingEngine();
    const outcome = await submitOrder(
      { ...marketInput, type: "limit", price: 40_000 },
      { mutate: engine.place, userId: "u1", invalidate: () => {} },
    );
    expect(outcome.result.status).toBe("accepted");
  });
});
