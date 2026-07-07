import type { RequestContext } from "@mvp/contracts";
import {
  type Candle,
  createTradeDataClient,
  type DataCacheEntry,
} from "@mvp/data";
import type { RequestTrace } from "@mvp/observability";
import { buildEquityCurve, type PnlPoint } from "./curve";

/**
 * The PnL snapshot the render layer consumes: a deterministic equity /
 * cumulative-PnL time series plus the symbol/interval it was derived from and
 * the account baseline.
 *
 * There is no dedicated equity-curve data source in the frozen catalog, so we
 * SYNTHESIZE the curve from the C5 `candles.history.<symbol>.<interval>` source
 * read through ONE shared C4 client (`createTradeDataClient`). Candle history is
 * deterministic (seeded fixtures), so the resulting PnL curve is byte-stable —
 * exactly what an ISR (60s) fragment wants. PnL is the mark-to-market of a fixed
 * `size` position opened at the first close (see `buildEquityCurve`).
 */
export type PnlSnapshot = {
  symbol: string;
  interval: string;
  /** Starting equity the curve is anchored to. */
  baseline: number;
  /** Deterministic equity / cumulative-PnL series over the period. */
  series: PnlPoint[];
};

/** Default equity baseline (matches the mock `accountMargin` 100k baseline). */
const DEFAULT_BASELINE = 100_000;
/** Interval whose candle history seeds the curve. */
const DEFAULT_INTERVAL = "1m";
/** Notional position size the price walk is marked against. */
const DEFAULT_SIZE = 1;

/**
 * Process-wide shared cache so the ISR curve read coalesces across SSR requests,
 * mirroring a long-lived server cache (same pattern as funding-bar's
 * `sharedCache`).
 */
const sharedCache = new Map<string, DataCacheEntry>();

/**
 * Reads the deterministic candle history for `symbol`/`interval` through the
 * frozen C4 client (never a bare fetch) and synthesizes the equity/PnL curve.
 * All reads go through the one client so the SSR request dedupes by
 * `createDataKey`.
 */
export async function loadPnlSnapshot(
  ctx: RequestContext,
  symbol: string,
  interval: string = DEFAULT_INTERVAL,
  trace?: RequestTrace,
): Promise<PnlSnapshot> {
  const client = createTradeDataClient({
    ctx,
    symbols: [symbol],
    intervals: [interval],
    cache: sharedCache,
    now: () => Date.now(),
  });

  const historyResult = await client.readData<Candle[]>(
    client.sourceIds.candlesHistory(symbol, interval),
    { symbol, interval },
  );

  void trace; // the candle read is already traced by the data client when wired.

  const series = buildEquityCurve(historyResult.data, {
    baseline: DEFAULT_BASELINE,
    size: DEFAULT_SIZE,
  });

  return {
    symbol,
    interval,
    baseline: DEFAULT_BASELINE,
    series,
  };
}
