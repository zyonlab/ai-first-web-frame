import type { RequestContext } from "@mvp/contracts";
import type {
  Candle,
  DataCacheEntry,
  FundingFrame,
  TickerFrame,
} from "@mvp/data";
import type { RequestTrace } from "@mvp/observability";
import { createTradeDataClient, type MarketRow } from "@mvp/trade-data";

/**
 * One enriched markets-table row. The base fields (`symbol`, `last`,
 * `change24h`, `changePct24h`) come straight from the C5 `markets.index`
 * source; `mark`, `funding` and `volume24h` are composed per-symbol from the
 * sibling `ticker.<symbol>` / `funding.<symbol>` / `candles.history.<symbol>`
 * sources — all read through the ONE shared C4 client (`createTradeDataClient`),
 * never a bare fetch.
 */
export type MarketsTableRow = {
  symbol: string;
  /** Mark price (from the ticker source). */
  mark: number;
  /** Last traded price (from the markets index). */
  last: number;
  /** Absolute 24h change in quote currency. */
  change24h: number;
  /** 24h change as a ratio (e.g. 0.0124 = +1.24%). */
  changePct24h: number;
  /** Current-interval funding rate (from the funding source). */
  funding: number;
  /** 24h traded volume in base units (summed from candle history). */
  volume24h: number;
};

/** The markets-table snapshot the render layer consumes. */
export type MarketsTableSnapshot = {
  rows: MarketsTableRow[];
  /** Data timestamp (ms) of the markets index frame. */
  ts: number;
};

/**
 * Process-wide shared cache so the short-TTL markets cache survives across SSR
 * requests, mirroring a long-lived server cache (same pattern as funding-bar's
 * `sharedCache`).
 */
const sharedCache = new Map<string, DataCacheEntry>();

/**
 * Reads the near-realtime markets index and enriches every row with mark price,
 * funding rate and 24h volume. All reads go through ONE C4 client so the SSR
 * request coalesces/dedupes by `createDataKey` (spine §4.1). Never a bare fetch.
 */
export async function loadMarketsSnapshot(
  ctx: RequestContext,
  trace?: RequestTrace,
): Promise<MarketsTableSnapshot> {
  // First read the index to learn which symbols exist, then register the C4
  // client for exactly those symbols so per-symbol sources resolve.
  const indexClient = createTradeDataClient({
    ctx,
    cache: sharedCache,
    now: () => Date.now(),
  });
  const indexResult = await indexClient.readData<MarketRow[]>(
    indexClient.sourceIds.marketsIndex,
  );
  const index = indexResult.data;
  const symbols = index.map((row) => row.symbol);

  const client = createTradeDataClient({
    ctx,
    symbols,
    cache: sharedCache,
    now: () => Date.now(),
  });

  const rows = await Promise.all(
    index.map(async (base): Promise<MarketsTableRow> => {
      const symbol = base.symbol;
      const [tickerResult, fundingResult, historyResult] = await Promise.all([
        client.readData<TickerFrame>(client.sourceIds.ticker(symbol), {
          symbol,
        }),
        client.readData<FundingFrame>(client.sourceIds.funding(symbol), {
          symbol,
        }),
        client.readData<Candle[]>(
          client.sourceIds.candlesHistory(symbol, "1m"),
          { symbol, interval: "1m" },
        ),
      ]);

      return {
        symbol,
        mark: tickerResult.data.mark,
        last: base.last,
        change24h: base.change24h,
        changePct24h: base.changePct24h,
        funding: fundingResult.data.rate,
        volume24h: sumVolume(historyResult.data),
      };
    }),
  );

  void trace; // reads are already traced by the data client when a trace is wired.

  return { rows, ts: Date.now() };
}

/** Sums candle volume into a deterministic 24h volume figure. */
function sumVolume(candles: Candle[]): number {
  return candles.reduce((total, candle) => total + candle.volume, 0);
}
