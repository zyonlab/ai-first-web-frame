import { describe, expect, it } from "vitest";
import {
  applyPositionsFrame,
  createPositionsState,
  directionOf,
  formatPnl,
  formatPositionRow,
  formatPrice,
  formatSize,
  onActiveSymbolChange,
  type PositionRow,
  pnlSign,
  positionKey,
  positionRowChanged,
  subscribePositions,
  TRADE_ACTIVE_SYMBOL,
} from "../src/patch";

function pos(symbol: string, over: Partial<PositionRow> = {}): PositionRow {
  return {
    symbol,
    size: 0.5,
    entryPrice: 62_883.35,
    markPrice: 63_003.35,
    liquidationPrice: 37_802.01,
    unrealizedPnl: 60,
    ...over,
  };
}

describe("positions-table patch — direction + sign", () => {
  it("derives long/short from signed size (0 counts as long)", () => {
    expect(directionOf(0.5)).toBe("long");
    expect(directionOf(-4)).toBe("short");
    expect(directionOf(0)).toBe("long");
  });

  it("maps uPnL to up/down sign (0 counts as up)", () => {
    expect(pnlSign(60)).toBe("up");
    expect(pnlSign(-12.5)).toBe("down");
    expect(pnlSign(0)).toBe("up");
  });
});

describe("positions-table patch — formatting", () => {
  it("formats price, size (abs), and signed uPnL deterministically", () => {
    expect(formatPrice(62_883.35)).toBe("62,883.35");
    // size is rendered as its absolute magnitude (direction carries the sign)
    expect(formatSize(-4)).toBe("4.0000");
    expect(formatSize(0.5)).toBe("0.5000");
    expect(formatPnl(60)).toBe("+60.00");
    expect(formatPnl(-12.5)).toBe("-12.50");
  });

  it("formats a whole row into stable cells", () => {
    const cells = formatPositionRow(
      pos("ETH", {
        size: -4,
        entryPrice: 3_109.01,
        markPrice: 3_101.01,
        liquidationPrice: 4_341.41,
        unrealizedPnl: 32,
      }),
    );
    expect(cells).toEqual({
      direction: "short",
      size: "4.0000",
      entry: "3,109.01",
      mark: "3,101.01",
      liq: "4,341.41",
      pnl: "+32.00",
      pnlSign: "up",
    });
  });
});

describe("positions-table patch — upsert + remove (pure)", () => {
  it("inserts newly opened symbols with an insert patch", () => {
    const state = createPositionsState({ positions: [pos("BTC")] });
    const { state: next, patch } = applyPositionsFrame(state, [
      pos("BTC"),
      pos("ETH", { size: -4 }),
    ]);
    expect(next.positions.map((p) => p.symbol)).toEqual(["BTC", "ETH"]);
    // BTC unchanged -> no patch; ETH new -> insert
    expect(patch.patches).toHaveLength(1);
    expect(patch.patches[0]).toMatchObject({ type: "insert", key: "ETH" });
    if (patch.patches[0].type === "insert") {
      expect(patch.patches[0].direction).toBe("short");
    }
  });

  it("updates a changed row in place keyed by symbol", () => {
    const state = createPositionsState({ positions: [pos("BTC")] });
    const { patch } = applyPositionsFrame(state, [
      pos("BTC", { markPrice: 63_100, unrealizedPnl: 108.5 }),
    ]);
    expect(patch.patches).toHaveLength(1);
    expect(patch.patches[0].type).toBe("update");
    if (patch.patches[0].type === "update") {
      expect(patch.patches[0].key).toBe("BTC");
      expect(patch.patches[0].cells.mark).toBe("63,100.00");
      expect(patch.patches[0].cells.pnl).toBe("+108.50");
    }
  });

  it("emits no patch for an unchanged frame (idempotent)", () => {
    const state = createPositionsState({
      positions: [pos("BTC"), pos("ETH", { size: -4, unrealizedPnl: 32 })],
    });
    const { patch } = applyPositionsFrame(state, [
      pos("BTC"),
      pos("ETH", { size: -4, unrealizedPnl: 32 }),
    ]);
    expect(patch.patches).toEqual([]);
  });

  it("removes symbols no longer present (position closed)", () => {
    const state = createPositionsState({
      positions: [pos("BTC"), pos("ETH", { size: -4 })],
    });
    const { state: next, patch } = applyPositionsFrame(state, [pos("BTC")]);
    expect(next.positions.map((p) => p.symbol)).toEqual(["BTC"]);
    expect(patch.patches).toEqual([{ type: "remove", key: "ETH" }]);
  });

  it("recolors uPnL on a sign flip (up -> down)", () => {
    const state = createPositionsState({ positions: [pos("BTC")] });
    const { patch } = applyPositionsFrame(state, [
      pos("BTC", { unrealizedPnl: -25 }),
    ]);
    if (patch.patches[0]?.type === "update") {
      expect(patch.patches[0].cells.pnlSign).toBe("down");
      expect(patch.patches[0].cells.pnl).toBe("-25.00");
    }
  });

  it("is deterministic: same input yields the same patch set", () => {
    const build = () => createPositionsState({ positions: [pos("BTC")] });
    const frame = [pos("BTC", { markPrice: 63_500 }), pos("ETH", { size: -4 })];
    const a = applyPositionsFrame(build(), frame);
    const b = applyPositionsFrame(build(), frame);
    expect(a.patch).toEqual(b.patch);
    expect(a.state.positions).toEqual(b.state.positions);
  });

  it("normalizes symbol keys (case/whitespace) for upsert matching", () => {
    expect(positionKey("  btc ")).toBe("BTC");
    const state = createPositionsState({ positions: [pos("BTC")] });
    // same symbol, different casing -> update (not a duplicate insert)
    const { state: next, patch } = applyPositionsFrame(state, [
      pos("btc", { markPrice: 63_500 }),
    ]);
    expect(next.positions).toHaveLength(1);
    expect(patch.patches[0]?.type).toBe("update");
  });

  it("positionRowChanged detects any rendered-field change", () => {
    const a = pos("BTC");
    expect(positionRowChanged(a, pos("BTC"))).toBe(false);
    expect(positionRowChanged(a, pos("BTC", { size: 1 }))).toBe(true);
    expect(positionRowChanged(a, pos("BTC", { liquidationPrice: 1 }))).toBe(
      true,
    );
  });
});

describe("positions-table patch — active symbol focus (C3)", () => {
  it("focuses the newly active row and clears the previous one", () => {
    const state = createPositionsState({
      activeSymbol: "BTC",
      positions: [pos("BTC"), pos("ETH", { size: -4 })],
    });
    const result = onActiveSymbolChange(state, { symbol: "eth" });
    expect(result).toBeDefined();
    if (result) {
      expect(result.patch).toEqual({
        type: "focus",
        activeKey: "ETH",
        previousKey: "BTC",
      });
      expect(result.state.activeSymbol).toBe("ETH");
      // rows are NOT dropped on a symbol switch (unlike the tape/book)
      expect(result.state.positions).toHaveLength(2);
    }
  });

  it("ignores a switch to the same symbol and malformed payloads", () => {
    const state = createPositionsState({
      activeSymbol: "BTC",
      positions: [pos("BTC")],
    });
    expect(onActiveSymbolChange(state, { symbol: "BTC" })).toBeUndefined();
    expect(onActiveSymbolChange(state, { symbol: 42 })).toBeUndefined();
    expect(onActiveSymbolChange(state, null)).toBeUndefined();
  });

  it("rejects a payload the frozen C3 schema forbids (extra key)", () => {
    const state = createPositionsState({ positions: [pos("BTC")] });
    expect(() =>
      onActiveSymbolChange(state, { symbol: "ETH", rogue: 1 }),
    ).toThrowError(/active-symbol/);
  });

  it("exposes the frozen active-symbol channel id", () => {
    expect(TRADE_ACTIVE_SYMBOL).toBe("trade.active-symbol");
  });
});

describe("positions-table patch — subscription wiring", () => {
  it("subscribes to the global positions feed and forwards frames", () => {
    const received: PositionRow[][] = [];
    let subscribedId = "";
    const client = {
      sourceIds: { positions: "positions" },
      subscribe: (id: string, handler: (e: { data: unknown }) => void) => {
        subscribedId = id;
        // array snapshot payload
        handler({ data: [pos("BTC"), pos("ETH", { size: -4 })] });
        // single-position delta payload (wrapped into an array)
        handler({ data: pos("SOL") });
        return () => {};
      },
    };
    subscribePositions(client, (frame) => received.push(frame));
    expect(subscribedId).toBe("positions");
    expect(received[0].map((p) => p.symbol)).toEqual(["BTC", "ETH"]);
    expect(received[1].map((p) => p.symbol)).toEqual(["SOL"]);
  });
});
