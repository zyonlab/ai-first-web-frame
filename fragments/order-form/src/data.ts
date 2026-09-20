import type { RequestContext } from "@mvp/contracts";
import type { DataCacheEntry } from "@mvp/data";
import {
  type AccountMargin,
  createTradeDataClient,
  type LeverageTiers,
  type SymbolMetadata,
  type TickerFrame,
} from "@mvp/trade-data";

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

/**
 * The instrument limits the order form must enforce: tick/lot/precision/max
 * leverage (`symbol.meta.<sym>`, isr ttl 300s) plus the margin ladder
 * (`leverage.tiers.<sym>`, static ttl 86400s).
 *
 * Read on the SSR path and carried into the island snapshot so the submit
 * guard has them before the first interaction — fetching them after hydration
 * would leave a window where the form accepts an order it must reject.
 *
 * Both are `public` sources on slow freshness tiers, so they cache across users
 * and never touch the user-private path `account` takes.
 */
export async function loadSymbolConstraints(
  ctx: RequestContext,
  cache: Map<string, DataCacheEntry>,
  symbol: string,
): Promise<{ meta: SymbolMetadata; tiers: LeverageTiers; markPrice: number }> {
  const client = createTradeDataClient({ ctx, cache, symbols: [symbol] });
  const [meta, tiers, ticker] = await Promise.all([
    client.readData<SymbolMetadata>(client.sourceIds.symbolMeta(symbol)),
    client.readData<LeverageTiers>(client.sourceIds.leverageTiers(symbol)),
    // A MARKET order has no price of its own, so its notional — and therefore
    // which margin tier governs it — can only be valued at the mark.
    client.readData<TickerFrame>(client.sourceIds.ticker(symbol)),
  ]);
  return {
    meta: meta.data,
    tiers: tiers.data,
    markPrice: ticker.data.mark,
  };
}

export type { AccountMargin, LeverageTiers, SymbolMetadata };
