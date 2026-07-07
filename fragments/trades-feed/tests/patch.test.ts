import { describe, expect, it } from "vitest";
import {
  clampLimit,
  createTapeState,
  DEFAULT_TRADES_LIMIT,
  formatPrintRow,
  formatTradeTime,
  MAX_TRADES_LIMIT,
  onActiveSymbolChange,
  prependPrint,
  resubscribeSymbol,
  type TapePrint,
  TRADE_ACTIVE_SYMBOL,
} from "../src/patch";

function print(seq: number, over: Partial<TapePrint> = {}): TapePrint {
  return {
    seq,
    ts: seq * 1000,
    side: "buy",
    price: 63_000 + seq,
    size: 0.5,
    symbol: "BTC",
    ...over,
  };
}

describe("trades-feed patch — formatting", () => {
  it("formats logical ts as stable UTC HH:MM:SS", () => {
    // 3661 ticks * 1000ms = 01:01:01 UTC from epoch.
    expect(formatTradeTime(3_661_000)).toBe("01:01:01");
    expect(formatTradeTime(0)).toBe("00:00:00");
  });

  it("formats price and size deterministically", () => {
    const cells = formatPrintRow({ ts: 1000, price: 64_120.5, size: 0.842 });
    expect(cells.time).toBe("00:00:01");
    expect(cells.price).toBe("64,120.50");
    expect(cells.size).toBe("0.8420");
  });
});

describe("trades-feed patch — limit clamping", () => {
  it("clamps to [1, MAX] with a default for garbage", () => {
    expect(clampLimit(Number.NaN)).toBe(DEFAULT_TRADES_LIMIT);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(9999)).toBe(MAX_TRADES_LIMIT);
    expect(clampLimit(12.9)).toBe(12);
  });
});

describe("trades-feed patch — prepend + cap (pure)", () => {
  it("prepends a new print at the head and emits a prepend patch", () => {
    const state = createTapeState({
      symbol: "BTC",
      limit: 5,
      prints: [print(3), print(2), print(1)],
    });
    const { state: next, patch } = prependPrint(state, print(4));
    expect(patch.type).toBe("prepend");
    expect(next.prints[0].seq).toBe(4);
    expect(next.prints.map((p) => p.seq)).toEqual([4, 3, 2, 1]);
    if (patch.type === "prepend") {
      expect(patch.seq).toBe(4);
      expect(patch.trimmedSeqs).toEqual([]);
      expect(patch.cells.price).toBe("63,004.00");
    }
  });

  it("caps the tape to the limit and reports trimmed seqs", () => {
    const state = createTapeState({
      symbol: "BTC",
      limit: 3,
      prints: [print(3), print(2), print(1)],
    });
    const { state: next, patch } = prependPrint(state, print(4));
    expect(next.prints.map((p) => p.seq)).toEqual([4, 3, 2]);
    if (patch.type === "prepend") {
      expect(patch.trimmedSeqs).toEqual([1]);
    }
  });

  it("is deterministic: same input yields the same patch", () => {
    const build = () =>
      createTapeState({
        symbol: "BTC",
        limit: 4,
        prints: [print(2), print(1)],
      });
    const a = prependPrint(build(), print(3));
    const b = prependPrint(build(), print(3));
    expect(a.patch).toEqual(b.patch);
    expect(a.state.prints.map((p) => p.seq)).toEqual(
      b.state.prints.map((p) => p.seq),
    );
  });

  it("no-ops on a duplicate seq (idempotent patches)", () => {
    const state = createTapeState({
      symbol: "BTC",
      limit: 5,
      prints: [print(3), print(2)],
    });
    const { state: next, patch } = prependPrint(state, print(3));
    expect(patch).toEqual({ type: "noop", reason: "duplicate" });
    expect(next).toBe(state);
  });

  it("no-ops on a stale (older) frame", () => {
    const state = createTapeState({
      symbol: "BTC",
      limit: 5,
      prints: [print(5), print(4)],
    });
    const { patch } = prependPrint(state, print(3));
    expect(patch).toEqual({ type: "noop", reason: "stale" });
  });

  it("keeps sell prints colored via side (used for buy/sell semantic color)", () => {
    const state = createTapeState({ symbol: "BTC", limit: 5, prints: [] });
    const { patch } = prependPrint(state, print(1, { side: "sell" }));
    if (patch.type === "prepend") expect(patch.side).toBe("sell");
  });
});

describe("trades-feed patch — symbol switch (clear + resubscribe)", () => {
  it("clears the tape and resets to the new symbol on activeSymbol change", () => {
    const state = createTapeState({
      symbol: "BTC",
      limit: 5,
      prints: [print(3), print(2), print(1)],
    });
    const result = onActiveSymbolChange(state, { symbol: "eth" });
    expect(result).toBeDefined();
    if (result) {
      expect(result.patch).toEqual({ type: "clear", symbol: "ETH" });
      expect(result.nextSymbol).toBe("ETH");
      expect(result.state.symbol).toBe("ETH");
      expect(result.state.prints).toEqual([]);
    }
  });

  it("ignores a switch to the same symbol and malformed payloads", () => {
    const state = createTapeState({ symbol: "BTC", limit: 5, prints: [] });
    expect(onActiveSymbolChange(state, { symbol: "BTC" })).toBeUndefined();
    expect(onActiveSymbolChange(state, { symbol: 42 })).toBeUndefined();
    expect(onActiveSymbolChange(state, null)).toBeUndefined();
  });

  it("subscribes to trades.<symbol> and forwards frames (single + array)", () => {
    const received: number[] = [];
    let subscribedId = "";
    const client = {
      sourceIds: { trades: (s: string) => `trades.${s}` },
      subscribe: (id: string, handler: (e: { data: unknown }) => void) => {
        subscribedId = id;
        handler({ data: print(10) });
        handler({ data: [print(11), print(12)] });
        return () => {};
      },
    };
    resubscribeSymbol(client, "ETH", (p) => received.push(p.seq));
    expect(subscribedId).toBe("trades.ETH");
    expect(received).toEqual([10, 11, 12]);
  });

  it("exposes the frozen active-symbol channel id", () => {
    expect(TRADE_ACTIVE_SYMBOL).toBe("trade.active-symbol");
  });
});
