import {
  CANCEL_ORDER_INVALIDATES,
  createMockMatchingEngine,
} from "@mvp/trade-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  applyOrderFrame,
  cancelOrderFlow,
  createOrdersState,
  formatOrderRow,
  type OpenOrder,
  onActiveSymbolChange,
  reconcileOrders,
  subscribeOrders,
  TRADE_ACTIVE_SYMBOL,
  toOpenOrder,
} from "../src/patch";

function order(
  orderId: string,
  over: Partial<OpenOrder> = {},
): Parameters<typeof toOpenOrder>[0] {
  return {
    orderId,
    symbol: "BTC",
    side: "buy",
    type: "limit",
    price: 63_000,
    size: 0.5,
    filled: 0,
    ...over,
  };
}

describe("open-orders patch — formatting", () => {
  it("formats an order row deterministically", () => {
    const cells = formatOrderRow(
      toOpenOrder(
        order("ord-1", { price: 64_120.5, size: 0.842, filled: 0.1 }),
      ),
    );
    expect(cells).toEqual({
      side: "Buy",
      type: "Limit",
      price: "64,120.50",
      size: "0.8420",
      filled: "0.1000",
    });
  });

  it("renders market orders with a Market price cell", () => {
    const cells = formatOrderRow(
      toOpenOrder(order("ord-2", { type: "market" })),
    );
    expect(cells.type).toBe("Market");
    expect(cells.price).toBe("Market");
  });

  it("defaults a missing filled to 0", () => {
    const o = toOpenOrder({
      orderId: "ord-3",
      symbol: "btc",
      side: "sell",
      type: "limit",
      price: 100,
      size: 1,
    });
    expect(o.filled).toBe(0);
    expect(o.symbol).toBe("BTC");
  });
});

describe("open-orders patch — row upsert / fill removal (pure)", () => {
  it("upserts a brand-new order as a row", () => {
    const state = createOrdersState({ symbol: "BTC", orders: [] });
    const { state: next, patch } = applyOrderFrame(state, order("ord-1"));
    expect(patch.type).toBe("upsert");
    expect(next.orders.map((o) => o.orderId)).toEqual(["ord-1"]);
    if (patch.type === "upsert") {
      expect(patch.orderId).toBe("ord-1");
      expect(patch.side).toBe("buy");
      expect(patch.cells.price).toBe("63,000.00");
    }
  });

  it("upserts (replaces) a changed order keyed by orderId", () => {
    const state = createOrdersState({
      symbol: "BTC",
      orders: [order("ord-1")],
    });
    const { state: next, patch } = applyOrderFrame(
      state,
      order("ord-1", { filled: 0.2 }),
    );
    expect(patch.type).toBe("upsert");
    expect(next.orders).toHaveLength(1);
    expect(next.orders[0].filled).toBe(0.2);
    if (patch.type === "upsert") expect(patch.cells.filled).toBe("0.2000");
  });

  it("removes an order once it is fully filled (filled >= size)", () => {
    const state = createOrdersState({
      symbol: "BTC",
      orders: [order("ord-1")],
    });
    const { state: next, patch } = applyOrderFrame(
      state,
      order("ord-1", { filled: 0.5 }),
    );
    expect(patch).toEqual({
      type: "remove",
      orderId: "ord-1",
      reason: "filled",
    });
    expect(next.orders).toEqual([]);
  });

  it("no-ops on an identical order (idempotent patch)", () => {
    const state = createOrdersState({
      symbol: "BTC",
      orders: [order("ord-1")],
    });
    const { state: next, patch } = applyOrderFrame(state, order("ord-1"));
    expect(patch).toEqual({ type: "noop", orderId: "ord-1" });
    expect(next).toBe(state);
  });

  it("ignores orders for a different symbol", () => {
    const state = createOrdersState({ symbol: "BTC", orders: [] });
    const { state: next, patch } = applyOrderFrame(
      state,
      order("ord-9", { symbol: "ETH" }),
    );
    expect(patch).toEqual({ type: "noop", orderId: "ord-9" });
    expect(next.orders).toEqual([]);
  });

  it("is deterministic: same input yields the same patch", () => {
    const build = () =>
      createOrdersState({ symbol: "BTC", orders: [order("ord-1")] });
    const a = applyOrderFrame(build(), order("ord-2", { price: 62_000 }));
    const b = applyOrderFrame(build(), order("ord-2", { price: 62_000 }));
    expect(a.patch).toEqual(b.patch);
    expect(a.state.orders.map((o) => o.orderId)).toEqual(
      b.state.orders.map((o) => o.orderId),
    );
  });
});

describe("open-orders patch — full-frame reconcile", () => {
  it("upserts new, keeps changed, removes vanished (filled/cancelled server-side)", () => {
    const state = createOrdersState({
      symbol: "BTC",
      orders: [order("ord-1"), order("ord-2")],
    });
    // Frame drops ord-2 (gone) and adds ord-3.
    const { state: next, patches } = reconcileOrders(state, [
      order("ord-1"),
      order("ord-3", { price: 61_000 }),
    ]);
    expect(next.orders.map((o) => o.orderId)).toEqual(["ord-1", "ord-3"]);
    const types = patches.map((p) => p.type);
    expect(types).toContain("upsert"); // ord-3
    expect(patches).toContainEqual({
      type: "remove",
      orderId: "ord-2",
      reason: "gone",
    });
  });
});

describe("open-orders patch — cancel flow (cancelOrder execute + resolveUserTags)", () => {
  it("cancels an order: mock mutate acks, invalidate resolves ONLY orders:<user>", async () => {
    const engine = createMockMatchingEngine();
    const invalidateSpy = vi.fn();

    const result = await cancelOrderFlow(
      { orderId: "ord-1", symbol: "BTC" },
      {
        mutate: engine.cancel,
        invalidate: invalidateSpy,
        userId: "u1",
      },
    );

    // Cancelled ack.
    expect(result.ack).toEqual({ orderId: "ord-1", status: "cancelled" });
    // Declared templates are exactly ["orders:{user}"] (nothing else touched).
    expect(result.declaredTags).toEqual(["orders:{user}"]);
    expect([...CANCEL_ORDER_INVALIDATES]).toEqual(["orders:{user}"]);
    // Resolved tag is orders:u1 — {user} correctly resolved, no other partition.
    expect(result.resolvedTags).toEqual(["orders:u1"]);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith(["orders:u1"]);
    // The remove patch the shim applies once the cancel acks.
    expect(result.patch).toEqual({
      type: "remove",
      orderId: "ord-1",
      reason: "cancelled",
    });
  });

  it("resolves {user} per user id and never invalidates positions/account/balances", async () => {
    const engine = createMockMatchingEngine();
    const seen: string[][] = [];
    const result = await cancelOrderFlow(
      { orderId: "ord-7", symbol: "ETH" },
      {
        mutate: engine.cancel,
        invalidate: (tags) => void seen.push(tags),
        userId: "trader-42",
      },
    );
    expect(result.resolvedTags).toEqual(["orders:trader-42"]);
    // The only invalidation call carries exactly the one resolved orders tag.
    expect(seen).toEqual([["orders:trader-42"]]);
    const flat = seen.flat();
    expect(flat.some((t) => t.startsWith("positions:"))).toBe(false);
    expect(flat.some((t) => t.startsWith("account:"))).toBe(false);
    expect(flat.some((t) => t.startsWith("balances:"))).toBe(false);
  });

  it("resolves tags INSIDE invalidate (declared templates unresolved on execute)", async () => {
    // The declared/returned templates keep the {user} placeholder; only the
    // invalidate handler sees the concrete id — proving execute was called with
    // no options.invalidates (which would be rejected as an undeclared tag).
    const result = await cancelOrderFlow(
      { orderId: "ord-1", symbol: "BTC" },
      {
        mutate: (input) => ({ orderId: input.orderId, status: "cancelled" }),
        invalidate: () => {},
        userId: "u1",
      },
    );
    expect(result.declaredTags).toEqual(["orders:{user}"]);
    expect(result.resolvedTags).toEqual(["orders:u1"]);
  });
});

describe("open-orders patch — symbol switch", () => {
  it("re-scopes to the new symbol, removing old rows and reconciling the new set", () => {
    const state = createOrdersState({
      symbol: "BTC",
      orders: [order("ord-1")],
    });
    const result = onActiveSymbolChange(state, { symbol: "eth" }, [
      order("ord-2", { symbol: "ETH" }),
    ]);
    expect(result).toBeDefined();
    if (result) {
      expect(result.nextSymbol).toBe("ETH");
      expect(result.state.symbol).toBe("ETH");
      expect(result.state.orders.map((o) => o.orderId)).toEqual(["ord-2"]);
      // old BTC row removed, new ETH row upserted.
      expect(result.patches).toContainEqual({
        type: "remove",
        orderId: "ord-1",
        reason: "gone",
      });
      expect(result.patches.some((p) => p.type === "upsert")).toBe(true);
    }
  });

  it("ignores a switch to the same symbol and malformed payloads", () => {
    const state = createOrdersState({ symbol: "BTC", orders: [] });
    expect(onActiveSymbolChange(state, { symbol: "BTC" })).toBeUndefined();
    expect(onActiveSymbolChange(state, { symbol: 42 })).toBeUndefined();
    expect(onActiveSymbolChange(state, null)).toBeUndefined();
  });

  it("exposes the frozen active-symbol channel id", () => {
    expect(TRADE_ACTIVE_SYMBOL).toBe("trade.active-symbol");
  });
});

describe("open-orders patch — subscription wiring", () => {
  it("subscribes to the global orders id and forwards frames (single + array)", () => {
    const frames: number[] = [];
    let subscribedId = "";
    const client = {
      sourceIds: { orders: "orders" },
      subscribe: (id: string, handler: (e: { data: unknown }) => void) => {
        subscribedId = id;
        handler({ data: [order("ord-1"), order("ord-2")] });
        handler({ data: order("ord-3") });
        return () => {};
      },
    };
    subscribeOrders(client, (orders) => frames.push(orders.length));
    expect(subscribedId).toBe("orders");
    expect(frames).toEqual([2, 1]);
  });
});
