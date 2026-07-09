import { describe, expect, it } from "vitest";
import type { FragmentManifestLike } from "../../release-tools/src/unit-graph";
import { describeMockWorld } from "./mock-world";

const orderFormManifest: FragmentManifestLike = {
  name: "order-form",
  dataDependencies: ["account"],
  consumes: {
    slices: [
      "trade.active-symbol",
      "trade.hovered-price",
      "trade.order-draft.price",
    ],
  },
  produces: { slices: ["trade.leverage", "trade.order-draft"] },
  layoutHint: { shape: "panel", fills: true },
};

describe("describeMockWorld", () => {
  it("derives the isolated-dev spec from a manifest", () => {
    const w = describeMockWorld(orderFormManifest);
    expect(w.component).toBe("order-form");
    expect(Object.keys(w.seededSlices).sort()).toEqual([
      "trade.active-symbol",
      "trade.hovered-price",
      "trade.order-draft.price",
    ]);
    expect(w.mockDataSources).toEqual(["account"]);
    expect(w.injectSlices).toContain("trade.active-symbol");
    expect(w.observeSlices).toEqual(["trade.leverage", "trade.order-draft"]);
    expect(w.layoutHint?.shape).toBe("panel");
  });

  it("seeds consumed slices with their C3 contract initial values", () => {
    const w = describeMockWorld(orderFormManifest);
    // The active-symbol slice's frozen initial is { symbol: "BTC" }.
    expect(w.seededSlices["trade.active-symbol"]).toEqual({ symbol: "BTC" });
  });

  it("handles a data-only fragment with no slices", () => {
    const w = describeMockWorld({
      name: "order-book",
      dataDependencies: ["book.l2.<symbol>"],
      layoutHint: { shape: "ladder", fills: true, minHeight: 300 },
    });
    expect(w.seededSlices).toEqual({});
    expect(w.mockDataSources).toEqual(["book.l2.<symbol>"]);
    expect(w.injectSlices).toEqual([]);
  });
});
