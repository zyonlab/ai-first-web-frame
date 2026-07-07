import type { RequestContext } from "@mvp/contracts";
import {
  createTradeDataClient,
  type DataCacheEntry,
  type OrderbookL2Frame,
} from "@mvp/data";

/**
 * Reads the initial L2 order-book snapshot for a symbol through the frozen data
 * plane — contract **C4** (`createTradeDataClient`) addressing the source by
 * contract **C5** id (`sourceIds.bookL2(symbol)`). No bare `fetch`: the mock
 * transport / fixtures back the read so SSR first paint is deterministic.
 *
 * A process-wide cache map is shared so realtime reads coalesce across requests
 * exactly like `promotion-banner`'s data plane.
 */
const sharedCache = new Map<string, DataCacheEntry>();

export async function loadOrderbookSnapshot(
  ctx: RequestContext,
  symbol: string,
): Promise<OrderbookL2Frame> {
  const client = createTradeDataClient({
    ctx,
    symbols: [symbol],
    cache: sharedCache,
  });
  const result = await client.readData<OrderbookL2Frame>(
    client.sourceIds.bookL2(symbol),
    { symbol },
  );
  return result.data;
}
