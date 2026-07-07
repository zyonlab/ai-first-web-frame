import type { OrderbookL2Frame } from "@mvp/data";
import { describe, expect, it } from "vitest";
import {
  buildLadder,
  diffLadder,
  formatPrice,
  formatSize,
  priceKey,
} from "../src/ladder";

function frame(
  bids: [number, number][],
  asks: [number, number][],
  seq = 1,
): OrderbookL2Frame {
  return {
    channel: "orderbook.l2",
    symbol: "BTC",
    seq,
    ts: 0,
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
    spread: asks[0][0] - bids[0][0],
  };
}

describe("order-book ladder math", () => {
  it("builds cumulative totals and normalized depth ratios", () => {
    const ladder = buildLadder(
      frame(
        [
          [100, 1],
          [99, 2],
        ],
        [
          [101, 3],
          [102, 1],
        ],
      ),
    );
    // cumulative from touch outward
    expect(ladder.bids.map((r) => r.total)).toEqual([1, 3]);
    expect(ladder.asks.map((r) => r.total)).toEqual([3, 4]);
    // depth normalized against the global max cumulative (4 on the ask side)
    expect(ladder.asks.at(-1)?.depth).toBe(1);
    expect(ladder.bids[0].depth).toBeCloseTo(0.25, 5);
    // derived spread + mid
    expect(ladder.spread).toBe(1);
    expect(ladder.mid).toBe(100.5);
  });

  it("keeps bid < ask and best-first ordering", () => {
    const ladder = buildLadder(
      frame(
        [
          [100, 1],
          [99, 1],
        ],
        [
          [101, 1],
          [102, 1],
        ],
      ),
    );
    expect(ladder.bids[0].price).toBeGreaterThan(ladder.bids[1].price);
    expect(ladder.asks[0].price).toBeLessThan(ladder.asks[1].price);
    expect(ladder.bids[0].price).toBeLessThan(ladder.asks[0].price);
  });

  it("limits per-side depth", () => {
    const ladder = buildLadder(
      frame(
        [
          [100, 1],
          [99, 1],
          [98, 1],
        ],
        [
          [101, 1],
          [102, 1],
          [103, 1],
        ],
      ),
      2,
    );
    expect(ladder.bids).toHaveLength(2);
    expect(ladder.asks).toHaveLength(2);
  });

  it("uses a stable price key for patch alignment", () => {
    expect(priceKey(64120.5)).toBe("64120.5");
    expect(priceKey(100)).toBe("100");
    expect(priceKey(0.001)).toBe("0.001");
  });

  it("diffs deterministically: only changed levels emit patches", () => {
    const prev = buildLadder(
      frame(
        [
          [100, 1],
          [99, 2],
        ],
        [
          [101, 3],
          [102, 1],
        ],
        1,
      ),
    );
    // Only the best bid size changed (1 -> 5).
    const next = buildLadder(
      frame(
        [
          [100, 5],
          [99, 2],
        ],
        [
          [101, 3],
          [102, 1],
        ],
        2,
      ),
    );
    const patchSet = diffLadder(prev, next);
    expect(patchSet.seq).toBe(2);
    const changed = patchSet.patches.filter((p) => p.key === "100");
    expect(changed).toHaveLength(1);
    expect(changed[0].side).toBe("bid");
    expect(changed[0].size).toBe(formatSize(5));
    expect(changed[0].flash).toBe("bid");
    // The best-ask row's size did not change, so if it emits a patch at all it
    // is only a depth renormalization (no size text, no flash).
    const ask101 = patchSet.patches.find((p) => p.key === "101");
    expect(ask101?.size).toBeUndefined();
    expect(ask101?.flash).toBeUndefined();
  });

  it("is a pure function: same input -> byte-identical patch set", () => {
    const a = buildLadder(frame([[100, 1]], [[101, 1]], 1));
    const b = buildLadder(frame([[100, 2]], [[101, 1]], 2));
    expect(JSON.stringify(diffLadder(a, b))).toBe(
      JSON.stringify(diffLadder(a, b)),
    );
  });

  it("marks newly appeared levels as added + flashed", () => {
    const prev = buildLadder(frame([[100, 1]], [[101, 1]], 1));
    const next = buildLadder(
      frame(
        [
          [100, 1],
          [99, 3],
        ],
        [[101, 1]],
        2,
      ),
    );
    const added = diffLadder(prev, next).patches.find((p) => p.key === "99");
    expect(added?.added).toBe(true);
    expect(added?.flash).toBe("bid");
  });

  it("reports removed levels", () => {
    const prev = buildLadder(
      frame(
        [
          [100, 1],
          [99, 1],
        ],
        [[101, 1]],
        1,
      ),
    );
    const next = buildLadder(frame([[100, 1]], [[101, 1]], 2));
    expect(diffLadder(prev, next).removed).toContainEqual({
      side: "bid",
      key: "99",
    });
  });

  it("formats prices and sizes deterministically", () => {
    expect(formatPrice(64120.5)).toBe("64,120.5");
    expect(formatSize(0.842)).toBe("0.842");
  });
});
