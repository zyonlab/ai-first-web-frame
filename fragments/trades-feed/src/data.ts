import type { RequestContext } from "@mvp/contracts";
import type { DataCacheEntry, TradePrintFrame } from "@mvp/data";
import { createTradeDataClient, normalizeSymbol } from "@mvp/trade-data";

/**
 * Reads the recent trades tape for a symbol through the frozen trade data
 * plane. The fragment NEVER uses a bare fetch: it goes through
 * `createTradeDataClient` (contract **C4**) which pre-registers the
 * `trades.<symbol>` source (contract **C5**, `sourceIds.trades(symbol)`) whose
 * SSR `load` returns the deterministic A0 fixture tape. That gives the SSR
 * first paint stable, byte-identical content the island then patches live.
 *
 * A process-wide cache map mirrors a long-lived server cache and lets the
 * shared-client dedupe coalesce concurrent reads of the same symbol.
 */
const sharedCache = new Map<string, DataCacheEntry>();

export async function loadRecentTrades(
  ctx: RequestContext,
  symbol: string,
): Promise<TradePrintFrame[]> {
  const normalized = normalizeSymbol(symbol);
  const client = createTradeDataClient({
    ctx,
    symbols: [normalized],
    cache: sharedCache,
  });
  const result = await client.readData<TradePrintFrame[]>(
    client.sourceIds.trades(normalized),
    { symbol: normalized },
  );
  return result.data;
}

export type { TradePrintFrame } from "@mvp/data";
