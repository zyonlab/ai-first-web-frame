import type { InteractionContract } from "@mvp/contracts";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createSliceStore, useStoreSlice } from "./index";

/**
 * Generic slice map used only by the tests. The store is generic over the
 * slice shape; concrete domain slices (e.g. trade's activeSymbol, orderDraft,
 * ...) are defined by domain packages like `@mvp/trade-contracts`, not here.
 */
type TestSlices = {
  activeSymbol: string;
  count: number;
};

const contracts: InteractionContract[] = [
  {
    channel: "activeSymbol",
    publisher: "slice-store",
    subscribers: ["slice-store"],
    payloadSchema: {},
  },
  {
    channel: "count",
    publisher: "slice-store",
    subscribers: ["slice-store"],
    payloadSchema: {},
  },
];

describe("createSliceStore", () => {
  it("returns the initial value for a slice", () => {
    const store = createSliceStore<TestSlices>(contracts, {
      initial: { activeSymbol: "BTC", count: 0 },
    });
    expect(store.get("activeSymbol")).toBe("BTC");
    expect(store.get("count")).toBe(0);
  });

  it("set updates the value and notifies subscribers of that slice", async () => {
    const store = createSliceStore<TestSlices>(contracts, {
      initial: { activeSymbol: "BTC", count: 0 },
    });
    const seen: string[] = [];
    const unsub = store.subscribe("activeSymbol", (v) => seen.push(v));
    await store.set("activeSymbol", "ETH");
    expect(store.get("activeSymbol")).toBe("ETH");
    expect(seen).toEqual(["ETH"]);
    unsub();
  });

  it("does not notify subscribers of unrelated slices", async () => {
    const store = createSliceStore<TestSlices>(contracts, {
      initial: { activeSymbol: "BTC", count: 0 },
    });
    const other = vi.fn();
    store.subscribe("count", other);
    await store.set("activeSymbol", "ETH");
    expect(other).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", async () => {
    const store = createSliceStore<TestSlices>(contracts, {
      initial: { activeSymbol: "BTC", count: 0 },
    });
    const fn = vi.fn();
    const unsub = store.subscribe("activeSymbol", fn);
    unsub();
    await store.set("activeSymbol", "ETH");
    expect(fn).not.toHaveBeenCalled();
  });

  it("throws when a slice has no declared interaction contract", () => {
    const store = createSliceStore<TestSlices>([contracts[0]], {
      initial: { activeSymbol: "BTC", count: 0 },
    });
    expect(() => store.get("count")).toThrow(/contract/i);
  });
});

describe("useStoreSlice", () => {
  it("returns the current slice value and re-renders on change", async () => {
    const store = createSliceStore<TestSlices>(contracts, {
      initial: { activeSymbol: "BTC", count: 0 },
    });
    const { result } = renderHook(() => useStoreSlice(store, "activeSymbol"));
    expect(result.current).toBe("BTC");
    await act(async () => {
      await store.set("activeSymbol", "ETH");
    });
    expect(result.current).toBe("ETH");
  });
});

describe("SSR safety", () => {
  it("createSliceStore works without a window (degraded pub/sub only)", async () => {
    const savedWindow = globalThis.window;
    // Simulate a server environment.
    // @ts-expect-error deleting a global for the SSR-degradation test
    globalThis.window = undefined;
    try {
      const store = createSliceStore<TestSlices>(contracts, {
        initial: { activeSymbol: "BTC", count: 0 },
      });
      const seen: string[] = [];
      store.subscribe("activeSymbol", (v) => seen.push(v));
      await store.set("activeSymbol", "ETH");
      expect(store.get("activeSymbol")).toBe("ETH");
      expect(seen).toEqual(["ETH"]);
    } finally {
      globalThis.window = savedWindow;
    }
  });
});
