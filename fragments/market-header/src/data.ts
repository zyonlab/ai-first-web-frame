import type { RequestContext } from "@mvp/contracts";
import type { DataCacheEntry, FundingFrame, TickerFrame } from "@mvp/data";
import type { RequestTrace } from "@mvp/observability";
import { createTradeDataClient, sourceIds } from "@mvp/trade-data";

/**
 * The SSR-safe pair of frames the header renders from. Both come through the
 * framework data plane (contract C4 `createTradeDataClient(ctx).readData` over
 * the C5 ids) — never a bare fetch. The loaders are seeded from the frozen
 * mock fixtures so SSR first paint is deterministic.
 */
export type MarketHeaderData = {
  symbol: string;
  ticker: TickerFrame;
  funding: FundingFrame;
};

/**
 * The flat, server-safe presentation model the SSR HTML and the island both
 * render. Kept string/number-only and free of any framework type so the island
 * can rebuild it from a ticker frame with the same pure function.
 */
export type MarketHeaderView = {
  symbol: string;
  /** Formatted mark price. */
  mark: string;
  /** Formatted oracle price (mark-anchored; `last` stands in as the index). */
  oracle: string;
  /** Formatted absolute 24h change. */
  change24h: string;
  /** Formatted signed 24h change percent, e.g. "+1.24%". */
  changePct24h: string;
  /** "up" | "down" | "flat" — drives the semantic color class. */
  direction: "up" | "down" | "flat";
  /** Formatted funding rate as a percent, e.g. "+0.0101%". */
  funding: string;
  /** Formatted 24h notional volume. */
  volume: string;
  /** Next-funding settlement timestamp (logical ms) for the countdown seed. */
  nextFundingTs: number;
  /** Funding interval length in ms. */
  fundingIntervalMs: number;
};

/** Formats a price with thousands separators + 2 decimals (locale-stable). */
function formatPrice(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Formats a ratio (0.0123) as a signed percent string ("+1.23%"). */
function formatSignedPct(ratio: number, decimals: number): string {
  const pct = ratio * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

/** Formats a large notional as a compact 24h volume string ("1.20B"). */
export function formatVolume(notional: number): string {
  const abs = Math.abs(notional);
  if (abs >= 1e9) return `${(notional / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(notional / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(notional / 1e3).toFixed(2)}K`;
  return notional.toFixed(2);
}

/**
 * Derives 24h notional volume deterministically from the ticker frame. There is
 * no volume field on `TickerFrame`, so we synthesize a stable value from
 * `last` + the per-stream `seq` — purely a function of the frame, so SSR and
 * the island agree.
 */
export function deriveVolume(ticker: TickerFrame): number {
  // last * a bounded multiplier seeded by seq → stable, symbol-distinct.
  const multiplier = 15_000 + (ticker.seq % 97) * 250;
  return Math.round(ticker.last * multiplier);
}

/**
 * Pure ticker-frame → view mapper (island-testable). Given a ticker + funding
 * frame it produces the display model; the island calls this with each new
 * ticker frame (reusing the last funding frame) to patch text nodes.
 */
export function toMarketHeaderView(
  ticker: TickerFrame,
  funding: FundingFrame,
): MarketHeaderView {
  const direction: MarketHeaderView["direction"] =
    ticker.changePct24h > 0 ? "up" : ticker.changePct24h < 0 ? "down" : "flat";
  return {
    symbol: ticker.symbol,
    mark: formatPrice(ticker.mark),
    // The oracle/index price stands in as `last` (index-anchored in the mock).
    oracle: formatPrice(ticker.last),
    change24h: formatSignedPct(
      ticker.change24h / Math.max(ticker.last, 1),
      2,
    ).replace("%", ""),
    changePct24h: formatSignedPct(ticker.changePct24h, 2),
    direction,
    funding: formatSignedPct(funding.rate, 4),
    volume: formatVolume(deriveVolume(ticker)),
    nextFundingTs: funding.nextFundingTs,
    fundingIntervalMs: funding.intervalMs,
  };
}

/**
 * Computes the next-funding countdown from a settlement timestamp and a logical
 * "now". Pure + deterministic (given `now`) so the island's countdown can be
 * unit-tested. Returns the clamped remaining ms plus an `HH:MM:SS` label.
 */
export function computeCountdown(
  nextFundingTs: number,
  nowMs: number,
): { remainingMs: number; label: string } {
  const remainingMs = Math.max(0, nextFundingTs - nowMs);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    remainingMs,
    label: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
  };
}

// A process-wide cache so the short-TTL cache survives across SSR requests,
// mirroring a long-lived server cache. Shared across the fragment's symbols.
const sharedCache = new Map<string, DataCacheEntry>();

/**
 * Loads the ticker + funding frames for a symbol through the C4 trade data
 * client (which pre-registers the C5 sources and seeds from the frozen mock
 * fixtures). One client per SSR request; `readData` coalesces concurrent reads
 * of the same key.
 */
export async function loadMarketHeaderData(
  ctx: RequestContext,
  symbol: string,
  trace?: RequestTrace,
): Promise<MarketHeaderData> {
  const client = createTradeDataClient({
    ctx,
    symbols: [symbol],
    cache: sharedCache,
  });

  const tickerSpan = trace?.startSpan(
    `data:${sourceIds.ticker(symbol)}`,
    "data",
  );
  const tickerResult = await client.readData<TickerFrame>(
    client.sourceIds.ticker(symbol),
    { symbol },
  );
  trace?.endSpan(tickerSpan ?? "", { status: "ok" });

  const fundingSpan = trace?.startSpan(
    `data:${sourceIds.funding(symbol)}`,
    "data",
  );
  const fundingResult = await client.readData<FundingFrame>(
    client.sourceIds.funding(symbol),
    { symbol },
  );
  trace?.endSpan(fundingSpan ?? "", { status: "ok" });

  return {
    symbol,
    ticker: tickerResult.data,
    funding: fundingResult.data,
  };
}
