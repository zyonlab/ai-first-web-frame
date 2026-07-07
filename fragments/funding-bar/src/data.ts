import type { RequestContext } from "@mvp/contracts";
import {
  createTradeDataClient,
  type DataCacheEntry,
  type FundingFrame,
  type TickerFrame,
} from "@mvp/data";
import type { RequestTrace } from "@mvp/observability";

/**
 * The funding snapshot the render layer consumes. It composes two C5 sources
 * read through ONE shared C4 client (`createTradeDataClient`): the
 * `funding.<symbol>` frame (rate + next-funding schedule) and the
 * `ticker.<symbol>` frame (mark price, used as the oracle-price proxy — the
 * FundingFrame itself carries no price). Both are near-realtime with a short
 * TTL, matching the fragment's `cached-ssr` 30s policy.
 */
export type FundingSnapshot = {
  symbol: string;
  /** Funding rate for the current interval (e.g. 0.0001 = 1 bps). */
  rate: number;
  /** Logical timestamp (ms) of the next funding settlement. */
  nextFundingTs: number;
  /** Funding interval length in ms (fixed at 8h by the generator). */
  intervalMs: number;
  /** Oracle/mark price for the symbol (from the ticker source). */
  oraclePrice: number;
  /** Data timestamp (ms) of the funding frame. */
  ts: number;
};

/**
 * Process-wide shared cache so the short-TTL funding cache survives across SSR
 * requests, mirroring a long-lived server cache (same pattern as
 * promotion-banner's `sharedCache`).
 */
const sharedCache = new Map<string, DataCacheEntry>();

/**
 * Reads the funding rate + next-funding schedule + oracle price for `symbol`
 * through the frozen C4 client (never a bare fetch). All reads go through the
 * one client so the SSR request coalesces/dedupes by `createDataKey`.
 */
export async function loadFundingSnapshot(
  ctx: RequestContext,
  symbol: string,
  trace?: RequestTrace,
): Promise<FundingSnapshot> {
  const client = createTradeDataClient({
    ctx,
    symbols: [symbol],
    cache: sharedCache,
    now: () => Date.now(),
  });

  const [fundingResult, tickerResult] = await Promise.all([
    client.readData<FundingFrame>(client.sourceIds.funding(symbol), {
      symbol,
    }),
    client.readData<TickerFrame>(client.sourceIds.ticker(symbol), {
      symbol,
    }),
  ]);

  void trace; // reads are already traced by the data client when a trace is wired.

  const funding = fundingResult.data;
  const ticker = tickerResult.data;

  return {
    symbol: funding.symbol,
    rate: funding.rate,
    nextFundingTs: funding.nextFundingTs,
    intervalMs: funding.intervalMs,
    oraclePrice: ticker.mark,
    ts: funding.ts,
  };
}
