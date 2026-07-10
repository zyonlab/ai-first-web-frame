import { createInteractionBus, type InteractionBus } from "@mvp/interaction";
import { clearIslandRegistry, getIsland } from "@mvp/islands";
import { createSliceStore, type SliceStore } from "@mvp/store";
import {
  initialTradeSlices,
  type OrderDraftPricePayload,
  TRADE_ACTIVE_SYMBOL,
  TRADE_LEVERAGE,
  TRADE_ORDER_DRAFT,
  TRADE_ORDER_DRAFT_PRICE,
  TRADE_STORE_OWNER,
  type TradeSlices,
  tradeSliceContracts,
  tradeStoreContracts,
} from "@mvp/trade-contracts";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  attachOrderbookPriceBridge,
  hydrateTrade,
  priceFromRow,
  registerTradeIslands,
} from "./hydrate";
import { getTradeStore, resetTradeStore } from "./tradeStore";

/** A fresh isolated store per test (own bus + slice values). */
function makeStore(): SliceStore<TradeSlices> {
  return createSliceStore<TradeSlices>(tradeStoreContracts, {
    initial: structuredClone(initialTradeSlices),
    owner: TRADE_STORE_OWNER,
  });
}

/** A fresh isolated interaction bus per test. */
function makeBus(): InteractionBus {
  return createInteractionBus({ contracts: tradeSliceContracts });
}

/**
 * The order-form island's SSR mount node, matching the frozen C2 markup the
 * `order-form` fragment emits (`data-island="orderForm"` + inline JSON snapshot
 * of `{ symbol, draft, account }`).
 */
function buildOrderFormNode(): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("data-island", "orderForm");
  const script = document.createElement("script");
  script.setAttribute("type", "application/json");
  script.setAttribute("data-island-props", "orderForm");
  script.textContent = JSON.stringify({
    props: {
      symbol: "BTC",
      draft: {
        side: "buy",
        type: "market",
        size: 1,
        leverage: 1,
        reduceOnly: false,
      },
      account: { equity: 12480.2, used: 4200, free: 8110, maintenance: 300 },
    },
    slice: TRADE_ORDER_DRAFT,
  });
  el.appendChild(script);
  return el;
}

/**
 * The account-bar island's SSR mount node, matching the frozen C2 markup
 * `account-bar/src/render.ts#renderAccountBarHtml` emits
 * (`data-island="accountBar"` + inline JSON snapshot of `{ view, seededLeverage }`).
 */
function buildAccountBarNode(): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("data-island", "accountBar");
  const script = document.createElement("script");
  script.setAttribute("type", "application/json");
  script.setAttribute("data-island-props", "accountBar");
  script.textContent = JSON.stringify({
    props: {
      view: {
        equity: "100,000.00",
        marginUsed: "20,000.00",
        withdrawable: "80,000.00",
        maintenance: "1,000.00",
        marginUsagePct: "20.00%",
        marginUsageRatio: 0.2,
        raw: {
          equity: 100_000,
          used: 20_000,
          free: 80_000,
          maintenance: 1_000,
        },
      },
      seededLeverage: 1,
    },
    slice: TRADE_LEVERAGE,
  });
  el.appendChild(script);
  return el;
}

/**
 * A single order-book row, exactly as `order-book/src/render.ts#rowHtml` emits
 * it: a `[data-price]` row whose price cell is `[data-field="price"]` carrying
 * the numeric price on `data-value`.
 */
function buildBookRow(priceKey: string, price: number): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = "ob-row ob-bid";
  tr.setAttribute("data-price", priceKey);
  tr.setAttribute("data-side", "bid");
  const priceCell = document.createElement("td");
  priceCell.className = "ob-price";
  priceCell.setAttribute("data-field", "price");
  priceCell.setAttribute("data-value", String(price));
  priceCell.textContent = price.toLocaleString("en-US");
  tr.appendChild(priceCell);
  return tr;
}

afterEach(() => {
  clearIslandRegistry();
  resetTradeStore();
  document.body.innerHTML = "";
});

describe("getTradeStore singleton", () => {
  beforeEach(() => resetTradeStore());

  it("returns the same shared store across calls", () => {
    const a = getTradeStore();
    const b = getTradeStore();
    expect(a).toBe(b);
  });

  it("rebuilds a fresh store after reset", () => {
    const a = getTradeStore();
    resetTradeStore();
    const b = getTradeStore();
    expect(a).not.toBe(b);
  });

  it("seeds every slice from initialTradeSlices", () => {
    const store = getTradeStore();
    expect(store.get(TRADE_ORDER_DRAFT_PRICE)).toEqual({ price: 0 });
    expect(store.get(TRADE_ACTIVE_SYMBOL)).toEqual({ symbol: "BTC" });
    expect(store.get(TRADE_LEVERAGE)).toEqual({ leverage: 1 });
  });
});

describe("registerTradeIslands", () => {
  it("registers all four React islands by their page slot names", () => {
    registerTradeIslands(makeStore(), makeBus());
    for (const name of ["marketHeader", "chart", "accountBar", "orderForm"]) {
      expect(getIsland(name)).toBeTypeOf("function");
    }
  });

  it("does not register the patch-only order-book island", () => {
    registerTradeIslands(makeStore(), makeBus());
    // `book` is vanilla (patch-only), not a React island — hydrateIslands skips
    // it because it is never registered.
    expect(getIsland("book")).toBeUndefined();
  });
});

describe("priceFromRow", () => {
  it("reads the numeric price from a clicked order-book row cell", () => {
    const row = buildBookRow("bid-42000", 42000);
    document.body.appendChild(row);
    const cell = row.querySelector('[data-field="price"]');
    expect(priceFromRow(cell)).toBe(42000);
  });

  it("returns null for elements outside any order-book row", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    expect(priceFromRow(div)).toBeNull();
    expect(priceFromRow(null)).toBeNull();
  });
});

describe("attachOrderbookPriceBridge", () => {
  it("publishes a clicked row price on TRADE_ORDER_DRAFT_PRICE only", () => {
    const store = makeStore();
    const priceUpdates: OrderDraftPricePayload[] = [];
    const symbolUpdates: unknown[] = [];
    store.subscribe(TRADE_ORDER_DRAFT_PRICE, (p) => priceUpdates.push(p));
    store.subscribe(TRADE_ACTIVE_SYMBOL, (p) => symbolUpdates.push(p));

    const root = document.createElement("div");
    const row = buildBookRow("bid-42000", 42000);
    root.appendChild(row);
    document.body.appendChild(root);
    const detach = attachOrderbookPriceBridge(store, root);

    row
      .querySelector('[data-field="price"]')
      ?.dispatchEvent(new Event("click", { bubbles: true }));

    expect(priceUpdates).toEqual([{ price: 42000 }]);
    // Only the target slice moved; the active-symbol slice is untouched.
    expect(symbolUpdates).toEqual([]);
    expect(store.get(TRADE_ORDER_DRAFT_PRICE)).toEqual({ price: 42000 });
    expect(store.get(TRADE_ACTIVE_SYMBOL)).toEqual({ symbol: "BTC" });

    detach();
    row
      .querySelector('[data-field="price"]')
      ?.dispatchEvent(new Event("click", { bubbles: true }));
    // No further publishes after teardown.
    expect(priceUpdates).toHaveLength(1);
  });

  it("ignores clicks that are not on an order-book row", () => {
    const store = makeStore();
    const priceUpdates: OrderDraftPricePayload[] = [];
    store.subscribe(TRADE_ORDER_DRAFT_PRICE, (p) => priceUpdates.push(p));
    const root = document.createElement("div");
    const stray = document.createElement("button");
    root.appendChild(stray);
    document.body.appendChild(root);
    attachOrderbookPriceBridge(store, root);
    stray.dispatchEvent(new Event("click", { bubbles: true }));
    expect(priceUpdates).toEqual([]);
  });
});

describe("hydrateTrade — signature order-book -> order-form flow", () => {
  it("mounts the real order-form island and reflects a clicked book price", async () => {
    const store = makeStore();

    const orderFormNode = buildOrderFormNode();
    const bookRow = buildBookRow("bid-41999.5", 41999.5);

    const root = document.createElement("div");
    root.setAttribute("data-page", "trade");
    root.appendChild(orderFormNode);
    root.appendChild(bookRow);
    document.body.appendChild(root);

    let handles: ReturnType<typeof hydrateTrade> | undefined;
    await act(async () => {
      handles = hydrateTrade(root, store);
    });

    // The real order-form island hydrated its SSR node (React content present).
    const form = orderFormNode.querySelector("[data-of-form]");
    expect(form).not.toBeNull();
    // Market order first paint: no price input yet.
    expect(orderFormNode.querySelector("[data-of-price] input")).toBeNull();

    // Click the order-book row -> price flows through the shared store into the
    // order-form draft (folded to a limit order), showing the price input with
    // the clicked value. No other fragment re-renders.
    await act(async () => {
      bookRow
        .querySelector('[data-field="price"]')
        ?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    // The shared price slice moved to the clicked price.
    expect(store.get(TRADE_ORDER_DRAFT_PRICE)).toEqual({ price: 41999.5 });

    // The order-form's price input now reflects the clicked price (limit).
    const priceInput = orderFormNode.querySelector<HTMLInputElement>(
      "[data-of-price] input",
    );
    expect(priceInput).not.toBeNull();
    expect(priceInput?.value).toBe("41999.5");

    // The order-form re-published the full draft (order-form is sole writer),
    // and the active-symbol slice was never touched by this flow.
    expect(store.get(TRADE_ORDER_DRAFT).price).toBe(41999.5);
    expect(store.get(TRADE_ACTIVE_SYMBOL)).toEqual({ symbol: "BTC" });

    await act(async () => handles?.teardown());
    // Teardown unmounts the island and clears the registry.
    expect(orderFormNode.querySelector("[data-of-form]")).toBeNull();
    expect(getIsland("orderForm")).toBeUndefined();
  });
});

describe("hydrateTrade — account-bar receives the shared bus (§4.3.2 fix)", () => {
  it("recomputes the margin preview when TRADE_LEVERAGE is published on the shared bus", async () => {
    const store = makeStore();
    const bus = makeBus();

    const accountBarNode = buildAccountBarNode();
    const root = document.createElement("div");
    root.appendChild(accountBarNode);
    document.body.appendChild(root);

    let handles: ReturnType<typeof hydrateTrade> | undefined;
    await act(async () => {
      handles = hydrateTrade(root, store, bus);
    });

    // Seeded at leverage 1: preview == the SSR view's own 20.00% usage.
    expect(
      accountBarNode.querySelector('[data-value="marginUsagePct"]')
        ?.textContent,
    ).toBe("20.00%");

    // Before the fix, account-bar built its OWN private bus internally, so a
    // publish on the shared bus (the one order-form/hydrate.tsx uses) would
    // never reach it. Publish with the leverage channel's declared publisher
    // ("order-form") exactly as `apps/page-trade` production code would.
    await act(async () => {
      await bus.publish(
        TRADE_LEVERAGE,
        { leverage: 4 },
        { owner: "order-form" },
      );
    });

    // used(20,000) / leverage(4) = 5,000 -> 5,000 / equity(100,000) = 5.00%.
    expect(
      accountBarNode.querySelector('[data-value="marginUsagePct"]')
        ?.textContent,
    ).toBe("5.00%");

    await act(async () => handles?.teardown());
  });
});
