import { describe, expect, it, vi } from "vitest";
import { createInteractionBus } from "../index";
import {
  applyLeverageChange,
  applyOrderbookPrice,
  applySymbolSwitch,
} from "./flows";
import {
  CANCEL_ORDER_INVALIDATES,
  cancelOrder,
  createMockMatchingEngine,
  PLACE_ORDER_INVALIDATES,
  placeOrder,
  resolveUserTags,
} from "./mutations";
import {
  CHART_INTERVALS,
  initialTradeSlices,
  isChartInterval,
  TRADE_ACTIVE_SYMBOL,
  TRADE_LEVERAGE,
  TRADE_ORDER_DRAFT,
  TRADE_ORDER_DRAFT_PRICE,
  TRADE_STORE_OWNER,
  tradeSliceContracts,
  tradeStoreContracts,
} from "./slices";

describe("trade store slices (C3)", () => {
  it("store contracts are single-owner and cover every canonical channel", () => {
    expect(tradeStoreContracts).toHaveLength(tradeSliceContracts.length);
    for (const contract of tradeStoreContracts) {
      expect(contract.publisher).toBe(TRADE_STORE_OWNER);
      expect(contract.subscribers).toContain(TRADE_STORE_OWNER);
    }
    const channels = new Set(tradeStoreContracts.map((c) => c.channel));
    for (const contract of tradeSliceContracts) {
      expect(channels.has(contract.channel)).toBe(true);
    }
  });

  it("accepts a valid slice payload and rejects an invalid one", async () => {
    const bus = createInteractionBus({ contracts: tradeStoreContracts });
    await expect(
      bus.publish(
        TRADE_ACTIVE_SYMBOL,
        { symbol: "ETH" },
        { owner: TRADE_STORE_OWNER },
      ),
    ).resolves.toEqual({ subscriberCount: expect.any(Number) });

    await expect(
      bus.publish(
        TRADE_ORDER_DRAFT,
        // missing required `leverage` / `reduceOnly`
        { side: "buy" },
        { owner: TRADE_STORE_OWNER },
      ),
    ).rejects.toThrow();
  });

  it("rejects an undeclared channel and a non-owner publisher", async () => {
    const bus = createInteractionBus({ contracts: tradeStoreContracts });
    await expect(
      bus.publish("trade.not-a-slice", { x: 1 }, { owner: TRADE_STORE_OWNER }),
    ).rejects.toThrow();
    await expect(
      bus.publish(
        TRADE_ACTIVE_SYMBOL,
        { symbol: "ETH" },
        { owner: "someone-else" },
      ),
    ).rejects.toThrow();
  });

  it("delivers a slice update only to that channel's subscribers", async () => {
    const bus = createInteractionBus({ contracts: tradeStoreContracts });
    const symbolSeen: unknown[] = [];
    const draftSeen: unknown[] = [];
    bus.subscribe(
      TRADE_ACTIVE_SYMBOL,
      (p) => {
        symbolSeen.push(p);
      },
      { subscriber: TRADE_STORE_OWNER },
    );
    bus.subscribe(
      TRADE_ORDER_DRAFT_PRICE,
      (p) => {
        draftSeen.push(p);
      },
      { subscriber: TRADE_STORE_OWNER },
    );
    await bus.publish(
      TRADE_ACTIVE_SYMBOL,
      { symbol: "SOL" },
      { owner: TRADE_STORE_OWNER },
    );
    expect(symbolSeen).toEqual([{ symbol: "SOL" }]);
    expect(draftSeen).toEqual([]);
  });

  it("canonical island contracts keep the order-book price fast-path separate", () => {
    const draft = tradeSliceContracts.find(
      (c) => c.channel === TRADE_ORDER_DRAFT,
    );
    const price = tradeSliceContracts.find(
      (c) => c.channel === TRADE_ORDER_DRAFT_PRICE,
    );
    // order-form is the sole writer of the full draft; order-book writes price.
    expect(draft?.publisher).toBe("order-form");
    expect(price?.publisher).toBe("order-book");
  });

  it("exposes sane initial slice values and a chart-interval guard", () => {
    expect(initialTradeSlices[TRADE_ACTIVE_SYMBOL]).toEqual({ symbol: "BTC" });
    expect(initialTradeSlices[TRADE_LEVERAGE]).toEqual({ leverage: 1 });
    expect(isChartInterval("1m")).toBe(true);
    expect(isChartInterval("3s")).toBe(false);
    for (const iv of CHART_INTERVALS) expect(isChartInterval(iv)).toBe(true);
  });
});

describe("trade mutations (C3 §6)", () => {
  it("place-order executes with declared template tags; the handler resolves {user}", async () => {
    const engine = createMockMatchingEngine(1);
    // The caller's invalidate handler is where {user} is resolved to a real id
    // before hitting the data cache — the declared tags stay templates so the
    // undeclared-tag guard (literal membership) passes.
    const cacheInvalidated: string[] = [];
    const { result, invalidated } = await placeOrder.execute(
      { symbol: "BTC", side: "buy", type: "market", size: 1, leverage: 5 },
      {
        mutate: (input) => engine.place(input),
        invalidate: (tags) => {
          cacheInvalidated.push(...resolveUserTags(tags, "u1"));
        },
      },
      // no options.invalidates -> uses the declared template set
    );
    expect(result.status).toBe("filled");
    expect(invalidated).toEqual([...PLACE_ORDER_INVALIDATES]);
    expect(cacheInvalidated).toEqual([
      "orders:u1",
      "positions:u1",
      "account:u1",
      "balances:u1",
    ]);
  });

  it("limit place-order rests (accepted) and a market order fills", () => {
    const engine = createMockMatchingEngine(1);
    expect(
      engine.place({
        symbol: "BTC",
        side: "buy",
        type: "limit",
        size: 1,
        price: 100,
        leverage: 2,
      }).status,
    ).toBe("accepted");
    expect(
      engine.place({
        symbol: "BTC",
        side: "sell",
        type: "market",
        size: 1,
        leverage: 2,
      }).status,
    ).toBe("filled");
  });

  it("cancel-order only invalidates the orders tag", async () => {
    const engine = createMockMatchingEngine(1);
    const cacheInvalidated: string[] = [];
    const { result, invalidated } = await cancelOrder.execute(
      { orderId: "ord-1", symbol: "BTC" },
      {
        mutate: (input) => engine.cancel(input),
        invalidate: (tags) => {
          cacheInvalidated.push(...resolveUserTags(tags, "u1"));
        },
      },
    );
    expect(result).toEqual({ orderId: "ord-1", status: "cancelled" });
    expect(invalidated).toEqual([...CANCEL_ORDER_INVALIDATES]);
    expect(cacheInvalidated).toEqual(["orders:u1"]);
  });

  it("rejects an undeclared invalidation tag before running", async () => {
    const cacheInvalidated: string[] = [];
    await expect(
      cancelOrder.execute(
        { orderId: "ord-1", symbol: "BTC" },
        {
          mutate: () => ({ orderId: "ord-1", status: "cancelled" as const }),
          invalidate: (tags) => {
            cacheInvalidated.push(...tags);
          },
        },
        { invalidates: ["positions:{user}"] }, // not in cancel's declared set
      ),
    ).rejects.toThrow();
    expect(cacheInvalidated).toEqual([]);
  });

  it("resolveUserTags substitutes the user placeholder", () => {
    expect(resolveUserTags(PLACE_ORDER_INVALIDATES, "abc")).toEqual([
      "orders:abc",
      "positions:abc",
      "account:abc",
      "balances:abc",
    ]);
  });
});

describe("canonical flow reducers (C3 §5.3)", () => {
  it("flow A: order-book price folds into the draft, keeping other fields", () => {
    const next = applyOrderbookPrice(
      { side: "sell", size: 2, leverage: 10, reduceOnly: true },
      { price: 42000 },
    );
    expect(next).toEqual({
      side: "sell",
      size: 2,
      leverage: 10,
      reduceOnly: true,
      price: 42000,
    });
  });

  it("flow B: leverage change yields broadcast payload + updated draft", () => {
    const { payload, draft } = applyLeverageChange(
      { side: "buy", leverage: 1, reduceOnly: false },
      20,
    );
    expect(payload).toEqual({ leverage: 20 });
    expect(draft.leverage).toBe(20);
  });

  it("flow C: symbol switch produces the active-symbol payload", async () => {
    // Publishing the switch updates ONLY the activeSymbol channel.
    const bus = createInteractionBus({ contracts: tradeStoreContracts });
    const leverageSeen = vi.fn();
    bus.subscribe(TRADE_LEVERAGE, leverageSeen, {
      subscriber: TRADE_STORE_OWNER,
    });
    await bus.publish(TRADE_ACTIVE_SYMBOL, applySymbolSwitch("ETH"), {
      owner: TRADE_STORE_OWNER,
    });
    expect(leverageSeen).not.toHaveBeenCalled();
  });
});
