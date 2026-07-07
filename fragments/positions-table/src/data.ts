import type { RequestContext } from "@mvp/contracts";
import {
  createTradeDataClient,
  type DataCacheEntry,
  type Position,
} from "@mvp/data";

/**
 * Reads the current open-positions snapshot through the frozen trade data plane.
 * The fragment NEVER uses a bare fetch: it goes through `createTradeDataClient`
 * (contract **C4**) which pre-registers the global `positions` source (contract
 * **C5**, `sourceIds.positions`) whose SSR `load` returns the deterministic A0
 * fixture positions. `positions` is realtime + user-private with NO mock
 * generator, so the client falls back to the core poll loop over the fixture
 * snapshot — SSR first paint is stable and byte-identical, and the island
 * patches live on top.
 *
 * A process-wide cache map mirrors a long-lived server cache and lets the
 * shared-client dedupe coalesce concurrent reads (the `account`/`positions`
 * shared-node dedupe of doc 02 §4).
 */
const sharedCache = new Map<string, DataCacheEntry>();

export async function loadPositions(ctx: RequestContext): Promise<Position[]> {
  const client = createTradeDataClient({ ctx, cache: sharedCache });
  const result = await client.readData<Position[]>(
    client.sourceIds.positions,
    {},
  );
  return result.data;
}

export type { Position } from "@mvp/data";
