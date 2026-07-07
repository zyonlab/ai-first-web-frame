import { describe, expect, it } from "vitest";
import type { AccountMargin, Balances, Position } from "../src/data";
import {
  directionOf,
  formatPositionRow,
  formatSignedUsd,
  formatUsd,
  marginUsageRatio,
  pnlSign,
  toPortfolioOverview,
  tradeHref,
} from "../src/view";

const account: AccountMargin = {
  equity: 100_000,
  used: 20_000,
  free: 80_000,
  maintenance: 1_000,
};

const balances: Balances = {
  equity: 100_240,
  withdrawable: 80_000,
  unrealizedPnl: 240,
};

describe("portfolio view formatters", () => {
  it("formats USD with thousands separators + 2 decimals", () => {
    expect(formatUsd(100_240)).toBe("100,240.00");
  });

  it("prefixes signed USD with + / -", () => {
    expect(formatSignedUsd(240)).toBe("+240.00");
    expect(formatSignedUsd(-32.5)).toBe("-32.50");
  });

  it("maps sign: >=0 up, <0 down", () => {
    expect(pnlSign(0)).toBe("up");
    expect(pnlSign(1)).toBe("up");
    expect(pnlSign(-0.01)).toBe("down");
  });

  it("derives direction from signed size", () => {
    expect(directionOf(0.5)).toBe("long");
    expect(directionOf(-4)).toBe("short");
  });

  it("clamps margin usage ratio into [0,1]", () => {
    expect(marginUsageRatio(account)).toBeCloseTo(0.2, 5);
    expect(marginUsageRatio({ ...account, equity: 0, used: 5 })).toBe(1);
  });

  it("builds the /trade/<SYMBOL> deep link (uppercased)", () => {
    expect(tradeHref("btc")).toBe("/trade/BTC");
  });
});

describe("toPortfolioOverview", () => {
  it("maps account + balances to the four card values", () => {
    const overview = toPortfolioOverview(account, balances);
    expect(overview.equity).toBe("100,240.00");
    expect(overview.unrealizedPnl).toBe("+240.00");
    expect(overview.unrealizedPnlSign).toBe("up");
    expect(overview.marginUsagePct).toBe("20.00%");
    expect(overview.marginUsageRatio).toBeCloseTo(0.2, 5);
    expect(overview.withdrawable).toBe("80,000.00");
  });

  it("colors a losing unrealized PnL as down", () => {
    const overview = toPortfolioOverview(account, {
      ...balances,
      unrealizedPnl: -500,
    });
    expect(overview.unrealizedPnl).toBe("-500.00");
    expect(overview.unrealizedPnlSign).toBe("down");
  });
});

describe("formatPositionRow", () => {
  const long: Position = {
    symbol: "btc",
    size: 0.5,
    entryPrice: 62_880,
    markPrice: 63_000,
    liquidationPrice: 37_800,
    unrealizedPnl: 60,
  };
  const short: Position = {
    symbol: "ETH",
    size: -4,
    entryPrice: 3_108,
    markPrice: 3_100,
    liquidationPrice: 4_340,
    unrealizedPnl: -32,
  };

  it("formats a long row with an uppercased deep-linked symbol", () => {
    const cells = formatPositionRow(long);
    expect(cells.symbol).toBe("BTC");
    expect(cells.href).toBe("/trade/BTC");
    expect(cells.direction).toBe("long");
    expect(cells.size).toBe("0.5000");
    expect(cells.entry).toBe("62,880.00");
    expect(cells.mark).toBe("63,000.00");
    expect(cells.pnl).toBe("+60.00");
    expect(cells.pnlSign).toBe("up");
  });

  it("formats a short row with a losing uPnL", () => {
    const cells = formatPositionRow(short);
    expect(cells.direction).toBe("short");
    expect(cells.size).toBe("4.0000");
    expect(cells.pnl).toBe("-32.00");
    expect(cells.pnlSign).toBe("down");
  });
});
