import type { AccountMargin } from "@mvp/trade-data";
import { describe, expect, it } from "vitest";
import { toAccountBarView } from "./data";
import { type IslandState, initialIslandState, islandReducer } from "./island";
import type { AccountBarIslandProps } from "./render";

/**
 * Island *reducer* tests. Imports `./island` (a `"use client"` React module), so
 * this suite needs the fragment's React devDependency installed — it pends a
 * fresh install in P2, exactly like `market-header/src/island.logic.test.ts`.
 * The framework-free account+leverage→margin math is covered install-free in
 * `data.logic.test.ts`.
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

describe("islandReducer", () => {
  const props: AccountBarIslandProps = {
    view: toAccountBarView(account()),
    seededLeverage: 1,
  };
  const initial: IslandState = initialIslandState(props);

  it("resumes from the SSR snapshot props unchanged (preview at seed)", () => {
    expect(initial.view.equity).toBe("100,092.00");
    expect(initial.leverage).toBe(1);
    expect(initial.preview.projectedWithdrawable).toBe("80,073.60");
  });

  it("recomputes only the margin preview on a leverage change (C3 flow B)", () => {
    const next = islandReducer(initial, { type: "leverage", leverage: 4 });
    expect(next.leverage).toBe(4);
    // used / 4 = 5,004.60 ; withdrawable = 95,087.40
    expect(next.preview.projectedMargin).toBe("5,004.60");
    expect(next.preview.projectedWithdrawable).toBe("95,087.40");
    // Committed view untouched by a preview change.
    expect(next.view.withdrawable).toBe("80,073.60");
  });

  it("returns the same state ref when leverage does not change", () => {
    const same = islandReducer(initial, { type: "leverage", leverage: 1 });
    expect(same).toBe(initial);
  });

  it("patches the view + re-derives preview on a realtime account frame", () => {
    const patched = islandReducer(
      { ...initial, leverage: 2 },
      {
        type: "account",
        account: account({
          equity: 120_000,
          used: 24_000,
          free: 96_000,
          maintenance: 1200,
        }),
      },
    );
    expect(patched.view.equity).toBe("120,000.00");
    expect(patched.view.marginUsed).toBe("24,000.00");
    // preview re-derived at the current leverage (2): 24,000 / 2 = 12,000
    expect(patched.preview.projectedMargin).toBe("12,000.00");
    expect(patched.preview.projectedWithdrawable).toBe("108,000.00");
  });
});
