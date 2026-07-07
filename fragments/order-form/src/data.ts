import type { RequestContext } from "@mvp/contracts";
import {
  type AccountMargin,
  createTradeDataClient,
  type DataCacheEntry,
} from "@mvp/data";

/**
 * Request-time account/margin read for the order-form first paint.
 *
 * Reads the shared `account` node (contract C5 `sourceIds.account`) through the
 * frozen C4 `createTradeDataClient` helper — never a bare fetch. `account` is a
 * request-time source (no TTL cache); the returned `AccountMargin`
 * (equity / used / free / maintenance) seeds the SSR margin preview so the form
 * has meaningful numbers before the island hydrates and patches realtime margin.
 *
 * A shared process-wide cache map is threaded in so that, within one SSR
 * request, account-bar / positions-table / order-form coalesce onto ONE
 * `account` resolution (the runtime's duplicate-data-resolution dedupe).
 */
export async function loadAccountMargin(
  ctx: RequestContext,
  cache: Map<string, DataCacheEntry>,
): Promise<AccountMargin> {
  const client = createTradeDataClient({ ctx, cache });
  const result = await client.readData<AccountMargin>(client.sourceIds.account);
  return result.data;
}

export type { AccountMargin };
