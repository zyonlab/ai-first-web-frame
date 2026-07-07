import type { AccountMargin } from "@mvp/data";
import { describe, expect, it } from "vitest";
import {
  computeMarginPreview,
  formatPct,
  formatUsd,
  marginUsageRatio,
  toAccountBarView,
} from "./data";

/**
 * Pure account+leverage→margin logic tests. Import ONLY from `./data` (no React
 * island, no fastify server), so this suite runs green without a fresh install
 * — it is the deterministic core the P2 deliverable requires.
 *
 * Values match the frozen mock `account` fixture: equity = 100000 + uPnL(92),
 * used = 20% of equity, free = equity - used, maintenance = 5% of used.
 */
function account(overrides: Partial<AccountMargin> = {}): AccountMargin {
  return {
    equity: 100_092,
    used: 20_018.4,
    free: 80_073.6,
    maintenance: 1000.92,
    ...overrides,
  };
}

describe("formatters", () => {
  it("formats USD with thousands separators + 2 decimals", () => {
    expect(formatUsd(100_092)).toBe("100,092.00");
    expect(formatUsd(80_073.6)).toBe("80,073.60");
  });

  it("formats a ratio as a 2-decimal percent", () => {
    expect(formatPct(0.2)).toBe("20.00%");
    expect(formatPct(0)).toBe("0.00%");
  });
});

describe("marginUsageRatio", () => {
  it("computes used / equity clamped to [0, 1]", () => {
    expect(marginUsageRatio(account())).toBeCloseTo(0.2, 6);
  });

  it("returns 1 when equity is non-positive and margin is used", () => {
    expect(marginUsageRatio(account({ equity: 0, used: 100 }))).toBe(1);
    expect(marginUsageRatio(account({ equity: 0, used: 0 }))).toBe(0);
  });

  it("clamps over-committed usage to 1", () => {
    expect(marginUsageRatio(account({ equity: 100, used: 250 }))).toBe(1);
  });
});

describe("toAccountBarView (account frame -> display model)", () => {
  it("maps the frozen account frame to a formatted, deterministic view", () => {
    const view = toAccountBarView(account());
    expect(view).toMatchObject({
      equity: "100,092.00",
      marginUsed: "20,018.40",
      withdrawable: "80,073.60",
      maintenance: "1,000.92",
      marginUsagePct: "20.00%",
    });
    expect(view.marginUsageRatio).toBeCloseTo(0.2, 6);
    expect(view.raw).toEqual({
      equity: 100_092,
      used: 20_018.4,
      free: 80_073.6,
      maintenance: 1000.92,
    });
  });
});

describe("computeMarginPreview (account + leverage -> margin preview)", () => {
  const view = toAccountBarView(account());

  it("at 1x the projected margin equals the committed margin used", () => {
    const preview = computeMarginPreview(view, 1);
    expect(preview.leverage).toBe(1);
    expect(preview.projectedMargin).toBe("20,018.40");
    expect(preview.projectedWithdrawable).toBe("80,073.60");
    expect(preview.projectedUsagePct).toBe("20.00%");
    expect(preview.projectedUsageRatio).toBeCloseTo(0.2, 6);
  });

  it("higher leverage locks less margin and frees more (deterministic)", () => {
    const preview = computeMarginPreview(view, 2);
    expect(preview.projectedMargin).toBe("10,009.20");
    expect(preview.projectedWithdrawable).toBe("90,082.80");
    expect(preview.projectedUsageRatio).toBeCloseTo(0.1, 6);

    const at4 = computeMarginPreview(view, 4);
    expect(at4.projectedMargin).toBe("5,004.60");
    expect(at4.projectedWithdrawable).toBe("95,087.40");
  });

  it("is deterministic: same inputs give byte-identical output", () => {
    expect(computeMarginPreview(view, 10)).toEqual(
      computeMarginPreview(view, 10),
    );
  });

  it("clamps leverage below 1 to 1 (no divide-by-zero / inversion)", () => {
    expect(computeMarginPreview(view, 0).leverage).toBe(1);
    expect(computeMarginPreview(view, -5).leverage).toBe(1);
    expect(computeMarginPreview(view, Number.NaN).leverage).toBe(1);
  });
});
