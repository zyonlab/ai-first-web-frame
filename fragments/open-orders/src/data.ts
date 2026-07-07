import type { RequestContext } from "@mvp/contracts";
import {
  createTradeDataClient,
  type DataCacheEntry,
  type WorkingOrder,
} from "@mvp/data";

/**
 * Reads the current working (open) orders through the frozen trade data plane.
 * The fragment NEVER uses a bare fetch: it goes through `createTradeDataClient`
 * (contract **C4**) which pre-registers the `orders` source (contract **C5**,
 * `sourceIds.orders` — a global, user-private, realtime id) whose SSR `load`
 * returns the deterministic fixture orders. That gives the SSR first paint
 * stable, byte-identical content the island then patches live on
 * fill/cancel/new-order frames.
 *
 * `orders` is a global (non-symbol-scoped) id: it is read by the constant
 * `client.sourceIds.orders`, not a symbol constructor. A process-wide cache map
 * mirrors a long-lived server cache and lets the shared-client dedupe coalesce
 * concurrent reads.
 */
const sharedCache = new Map<string, DataCacheEntry>();

export async function loadOpenOrders(
  ctx: RequestContext,
): Promise<WorkingOrder[]> {
  const client = createTradeDataClient({ ctx, cache: sharedCache });
  const result = await client.readData<WorkingOrder[]>(client.sourceIds.orders);
  return result.data;
}

export type { WorkingOrder } from "@mvp/data";
