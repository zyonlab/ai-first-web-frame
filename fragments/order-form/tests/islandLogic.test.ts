import { describe, expect, it } from "vitest";
import {
  changeLeverage,
  createDefaultDraft,
  foldOrderbookPrice,
  isDraftSubmittable,
  type OrderFormDraft,
  setOrderType,
  setReduceOnly,
  setSide,
  setSize,
  toPlaceOrderInput,
} from "../src/islandLogic";

describe("order-form island logic — C3 reducers (pure)", () => {
  it("createDefaultDraft is the SSR seed (buy/market/1x/reduceOnly false)", () => {
    expect(createDefaultDraft()).toEqual({
      side: "buy",
      type: "market",
      leverage: 1,
      reduceOnly: false,
    });
  });

  it("Flow A: folds an order-book price into the draft and flips to limit", () => {
    const draft = createDefaultDraft({ size: 2 });
    const next = foldOrderbookPrice(draft, { price: 42_000 });
    expect(next.price).toBe(42_000);
    expect(next.type).toBe("limit");
    // side/size/leverage/reduceOnly intact
    expect(next.side).toBe("buy");
    expect(next.size).toBe(2);
    expect(next.leverage).toBe(1);
    expect(next.reduceOnly).toBe(false);
    // immutable
    expect(draft.price).toBeUndefined();
  });

  it("Flow B: leverage change yields the broadcast payload AND the folded draft", () => {
    const draft = createDefaultDraft({ size: 1 });
    const { payload, draft: next } = changeLeverage(draft, 20);
    expect(payload).toEqual({ leverage: 20 });
    expect(next.leverage).toBe(20);
    // other fields intact + immutable
    expect(next.size).toBe(1);
    expect(draft.leverage).toBe(1);
  });

  it("setSide / setOrderType / setSize / setReduceOnly update immutably", () => {
    let draft = createDefaultDraft();
    draft = setSide(draft, "sell");
    expect(draft.side).toBe("sell");
    draft = setOrderType(draft, "limit");
    expect(draft.type).toBe("limit");
    draft = setSize(draft, 3.5);
    expect(draft.size).toBe(3.5);
    draft = setReduceOnly(draft, true);
    expect(draft.reduceOnly).toBe(true);
  });

  it("setOrderType('market') drops a stale limit price", () => {
    const limit: OrderFormDraft = {
      side: "buy",
      type: "limit",
      price: 100,
      leverage: 1,
      reduceOnly: false,
    };
    const market = setOrderType(limit, "market");
    expect(market.type).toBe("market");
    expect(market.price).toBeUndefined();
  });

  it("setSize clears on empty / non-positive / non-finite", () => {
    const base = createDefaultDraft({ size: 5 });
    expect(setSize(base, undefined).size).toBeUndefined();
    expect(setSize(base, 0).size).toBeUndefined();
    expect(setSize(base, -1).size).toBeUndefined();
    expect(setSize(base, Number.NaN).size).toBeUndefined();
    expect(setSize(base, 2).size).toBe(2);
  });
});

describe("order-form submit guard + place-order payload", () => {
  it("market order is submittable with a positive size", () => {
    const draft = createDefaultDraft({ size: 1 });
    expect(isDraftSubmittable(draft)).toBe(true);
  });

  it("market order without size is not submittable", () => {
    expect(isDraftSubmittable(createDefaultDraft())).toBe(false);
  });

  it("limit order requires both size and price", () => {
    const noPrice = createDefaultDraft({ type: "limit", size: 1 });
    expect(isDraftSubmittable(noPrice)).toBe(false);
    const ok = createDefaultDraft({ type: "limit", size: 1, price: 100 });
    expect(isDraftSubmittable(ok)).toBe(true);
  });

  it("toPlaceOrderInput projects a market draft (omits price)", () => {
    const draft = createDefaultDraft({ side: "sell", size: 2, leverage: 10 });
    const input = toPlaceOrderInput("BTC", draft);
    expect(input).toEqual({
      symbol: "BTC",
      side: "sell",
      type: "market",
      size: 2,
      leverage: 10,
      reduceOnly: false,
    });
    expect("price" in input).toBe(false);
  });

  it("toPlaceOrderInput projects a limit draft (includes price + reduceOnly)", () => {
    const draft = createDefaultDraft({
      type: "limit",
      side: "buy",
      size: 1,
      price: 41_000,
      leverage: 5,
      reduceOnly: true,
    });
    const input = toPlaceOrderInput("ETH", draft);
    expect(input).toEqual({
      symbol: "ETH",
      side: "buy",
      type: "limit",
      size: 1,
      price: 41_000,
      leverage: 5,
      reduceOnly: true,
    });
  });

  it("toPlaceOrderInput throws on an unsubmittable draft", () => {
    expect(() => toPlaceOrderInput("BTC", createDefaultDraft())).toThrow();
  });
});
