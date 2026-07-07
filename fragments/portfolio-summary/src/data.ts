import type { RequestContext } from "@mvp/contracts";
import {
  type AccountMargin,
  type Balances,
  createTradeDataClient,
  type DataCacheEntry,
  type Position,
  sourceIds,
} from "@mvp/data";
import type { RequestTrace } from "@mvp/observability";

/**
 * The request-time portfolio snapshot the render layer consumes. It composes
 * THREE frozen C5 user-private sources read through ONE shared C4 client
 * (`createTradeDataClient`): `account` (request-time margin), `positions`
 * (realtime open positions, poll fallback / fixture seed), and `balances`
 * (request-time equity / withdrawable / unrealized PnL). Reads never use a bare
 * fetch — all go through `client.readData` so the SSR request coalesces by
 * `createDataKey` (the `account` node is shared with account-bar / order-form).
 */
export type PortfolioSnapshot = {
  account: AccountMargin;
  balances: Balances;
  positions: Position[];
};

/**
 * Process-wide shared cache so the read cache survives across SSR requests,
 * mirroring a long-lived server cache (same pattern as account-bar /
 * positions-table). Shared across the fragment.
 */
const sharedCache = new Map<string, DataCacheEntry>();

/**
 * Loads the account margin, balances, and open positions through the C4 trade
 * data client (which pre-registers the C5 sources and seeds from the frozen mock
 * fixtures so SSR first paint is deterministic). One client per SSR request;
 * `readData` coalesces concurrent reads of the same key so the shared `account`
 * node resolves once across sibling fragments.
 */
export async function loadPortfolioSnapshot(
  ctx: RequestContext,
  trace?: RequestTrace,
): Promise<PortfolioSnapshot> {
  const client = createTradeDataClient({ ctx, cache: sharedCache });

  const accountSpan = trace?.startSpan(`data:${sourceIds.account}`, "data");
  const positionsSpan = trace?.startSpan(`data:${sourceIds.positions}`, "data");
  const balancesSpan = trace?.startSpan(`data:${sourceIds.balances}`, "data");

  const [accountResult, positionsResult, balancesResult] = await Promise.all([
    client.readData<AccountMargin>(client.sourceIds.account),
    client.readData<Position[]>(client.sourceIds.positions, {}),
    client.readData<Balances>(client.sourceIds.balances),
  ]);

  trace?.endSpan(accountSpan ?? "", { status: "ok" });
  trace?.endSpan(positionsSpan ?? "", { status: "ok" });
  trace?.endSpan(balancesSpan ?? "", { status: "ok" });

  return {
    account: accountResult.data,
    balances: balancesResult.data,
    positions: positionsResult.data,
  };
}

export type { AccountMargin, Balances, Position } from "@mvp/data";
