/**
 * Pure, deterministic presentation model for the portfolio summary (NO React,
 * no DOM). Every function here is a total function of its inputs so the SSR HTML
 * is byte-identical across identical snapshots and the whole view is unit
 * testable without a running server.
 *
 * The overview cards use up/down semantic classes on the unrealized PnL so a
 * profit renders in the "up" color and a loss in the "down" color; every numeric
 * value is formatted with tabular (mono) digits via the CSS. Position `symbol`
 * cells become deep links to `/trade/<SYMBOL>`.
 */

import type { AccountMargin, Balances, Position } from "./data";

/** Sign class for a signed value: "up" (>=0) or "down" (<0). Drives color. */
export type PnlSign = "up" | "down";

/** Maps a signed number to its up/down sign (0 counts as up). */
export function pnlSign(value: number): PnlSign {
  return value < 0 ? "down" : "up";
}

/** Long / short direction, derived from the (signed) position size. */
export type PositionDirection = "long" | "short";

/** Direction from a signed size: positive = long, negative = short. */
export function directionOf(size: number): PositionDirection {
  return size < 0 ? "short" : "long";
}

/** Formats a USD amount with thousands separators + 2 decimals (locale-stable). */
export function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Formats a signed USD amount with an explicit +/- sign prefix (mono). */
export function formatSignedUsd(value: number): string {
  const sign = value < 0 ? "-" : "+";
  return `${sign}${formatUsd(Math.abs(value))}`;
}

/** Formats a ratio (0.2) as a 2-decimal percent string ("20.00%"). */
export function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

/** Formats a position size as its absolute magnitude with 4 decimals (mono). */
export function formatSize(size: number): string {
  return Math.abs(size).toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

/** Clamps the margin usage ratio into [0, 1] (equity <= 0 → fully used). */
export function marginUsageRatio(account: AccountMargin): number {
  if (account.equity <= 0) return account.used > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, account.used / account.equity));
}

/** Normalizes a symbol to its canonical (uppercase, trimmed) key form. */
export function symbolKey(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/** The `/trade/<SYMBOL>` deep-link href for a position symbol. */
export function tradeHref(symbol: string): string {
  return `/trade/${encodeURIComponent(symbolKey(symbol))}`;
}

/** The four overview stat cards (all strings + a color hint on uPnL). */
export type PortfolioOverview = {
  /** Formatted total account equity. */
  equity: string;
  /** Formatted unrealized PnL with explicit sign. */
  unrealizedPnl: string;
  /** Up/down color hint for the unrealized PnL card. */
  unrealizedPnlSign: PnlSign;
  /** Formatted margin usage percent, e.g. "20.00%". */
  marginUsagePct: string;
  /** Margin usage ratio in [0, 1] for the `--usage` meter var. */
  marginUsageRatio: number;
  /** Formatted margin currently used. */
  marginUsed: string;
  /** Formatted withdrawable (free) balance. */
  withdrawable: string;
};

/**
 * Pure `(account, balances) → overview` mapper. `unrealizedPnl` comes from the
 * balances source (authoritative) and its sign drives the card color; margin
 * usage is `used / equity` from the account frame.
 */
export function toPortfolioOverview(
  account: AccountMargin,
  balances: Balances,
): PortfolioOverview {
  const ratio = marginUsageRatio(account);
  return {
    equity: formatUsd(balances.equity),
    unrealizedPnl: formatSignedUsd(balances.unrealizedPnl),
    unrealizedPnlSign: pnlSign(balances.unrealizedPnl),
    marginUsagePct: formatPct(ratio),
    marginUsageRatio: ratio,
    marginUsed: formatUsd(account.used),
    withdrawable: formatUsd(balances.withdrawable),
  };
}

/** Formatted cells for a single position row, all strings (deterministic). */
export type PortfolioPositionCells = {
  symbol: string;
  href: string;
  direction: PositionDirection;
  size: string;
  entry: string;
  mark: string;
  pnl: string;
  pnlSign: PnlSign;
};

/** Formats every rendered cell of a position row deterministically. */
export function formatPositionRow(position: Position): PortfolioPositionCells {
  const key = symbolKey(position.symbol);
  return {
    symbol: key,
    href: tradeHref(key),
    direction: directionOf(position.size),
    size: formatSize(position.size),
    entry: formatUsd(position.entryPrice),
    mark: formatUsd(position.markPrice),
    pnl: formatSignedUsd(position.unrealizedPnl),
    pnlSign: pnlSign(position.unrealizedPnl),
  };
}
