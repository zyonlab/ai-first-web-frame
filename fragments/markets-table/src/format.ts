/**
 * Pure, deterministic formatting helpers for the markets table. No clock, no
 * DOM — safe on the server and unit-tested in isolation. The same helpers seed
 * the SSR cells and (optionally) the tiny vanilla price-tick patch, so the
 * client label matches the server label byte-for-byte.
 */

/** Semantic sign of a 24h change → up/down/flat token mapped to a CSS class. */
export function changeDirection(value: number): "up" | "down" | "flat" {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

/**
 * Formats a price with a symbol-appropriate number of decimals: 2 for
 * >= 100 (BTC/ETH range), 4 for smaller-priced assets. Thousands grouped.
 */
export function formatPrice(value: number): string {
  const decimals = Math.abs(value) >= 100 ? 2 : 4;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Formats a 24h change ratio as a signed percentage (e.g. `+1.24%`). */
export function formatChangePct(ratio: number, decimals = 2): string {
  const pct = ratio * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

/** Formats a funding rate as a signed percentage (e.g. `+0.0101%`). */
export function formatFundingRate(rate: number, decimals = 4): string {
  const pct = rate * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

/**
 * Compacts a large notional volume into a `K`/`M`/`B` suffixed label
 * (e.g. `1.20B`, `640.00M`). Values below 1,000 render with 2 decimals.
 */
export function formatVolume(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(2);
}

/** The canonical deep-link path for a symbol's trade page (`/trade/<SYMBOL>`). */
export function tradeHref(symbol: string): string {
  return `/trade/${encodeURIComponent(symbol.trim().toUpperCase())}`;
}
