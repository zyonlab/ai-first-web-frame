import type { RequestContext } from "@mvp/contracts";
import type { DataCacheEntry } from "@mvp/data";
import type { RequestTrace } from "@mvp/observability";
import {
  createTradeDataClient,
  type Candle as DataCandle,
  sourceIds,
} from "@mvp/trade-data";

/**
 * The SSR-safe candle history the chart renders from. It comes through the
 * framework data plane (contract C4 `createTradeDataClient(ctx).readData` over
 * the C5 `candles.history.<symbol>.<interval>` id) — never a bare fetch. The
 * loader is seeded from the frozen `seedCandles` mock fixtures so SSR first
 * paint is deterministic.
 */
export type ChartHistoryData = {
  symbol: string;
  interval: string;
  history: DataCandle[];
};

// A process-wide cache so the ISR history cache survives across SSR requests,
// mirroring a long-lived server cache. Shared across the fragment's symbols.
const sharedCache = new Map<string, DataCacheEntry>();

/**
 * Loads the candle history bootstrap for a (symbol, interval) through the C4
 * trade data client (which pre-registers the C5 sources and seeds from the
 * frozen mock fixtures). One client per SSR request; `readData` coalesces
 * concurrent reads of the same key.
 */
export async function loadChartHistory(
  ctx: RequestContext,
  symbol: string,
  interval: string,
  trace?: RequestTrace,
  cache: Map<string, DataCacheEntry> = sharedCache,
): Promise<ChartHistoryData> {
  const client = createTradeDataClient({
    ctx,
    symbols: [symbol],
    intervals: [interval],
    cache,
  });

  const id = sourceIds.candlesHistory(symbol, interval);
  const historySpan = trace?.startSpan(`data:${id}`, "data");
  const result = await client.readData<DataCandle[]>(id, { symbol, interval });
  trace?.endSpan(historySpan ?? "", { status: "ok" });

  return {
    symbol,
    interval,
    history: result.data,
  };
}
