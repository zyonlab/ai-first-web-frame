import type { RequestContext } from "@mvp/contracts";
import type { DataCacheEntry } from "@mvp/data";
import type { RequestTrace } from "@mvp/observability";
import {
  type AccountMargin,
  createTradeDataClient,
  sourceIds,
} from "@mvp/trade-data";

/**
 * The SSR-safe account frame the bar renders from. It comes through the
 * framework data plane (contract C4 `createTradeDataClient(ctx).readData` over
 * the C5 `account` id) — never a bare fetch. The loader is seeded from the
 * frozen mock fixtures so SSR first paint is deterministic.
 */
export type AccountBarData = {
  account: AccountMargin;
};

/**
 * The flat, server-safe presentation model the SSR HTML and the island both
 * render. Kept string/number-only and free of any framework type so the island
 * can rebuild it from an account frame (+ leverage) with the same pure
 * functions.
 *
 * `AccountMargin` carries `{ equity, used, free, maintenance }`; the demo maps
 * `withdrawable := free` (free margin is what can be withdrawn). `marginUsagePct`
 * is `used / equity` clamped to [0, 1] and drives the small usage meter.
 */
export type AccountBarView = {
  /** Formatted account equity. */
  equity: string;
  /** Formatted margin currently used (initial margin). */
  marginUsed: string;
  /** Formatted withdrawable (free) margin. */
  withdrawable: string;
  /** Formatted maintenance margin. */
  maintenance: string;
  /** Formatted margin usage percent, e.g. "20.00%". */
  marginUsagePct: string;
  /** Margin usage ratio in [0, 1] for the `--usage` meter var. */
  marginUsageRatio: number;
  /** Raw numbers carried so the island can recompute a leverage preview. */
  raw: {
    equity: number;
    used: number;
    free: number;
    maintenance: number;
  };
};

/** Formats a USD amount with thousands separators + 2 decimals (locale-stable). */
export function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Formats a ratio (0.2) as a 2-decimal percent string ("20.00%"). */
export function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

/** Clamps the margin usage ratio into [0, 1] (equity <= 0 → fully used). */
export function marginUsageRatio(account: AccountMargin): number {
  if (account.equity <= 0) return account.used > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, account.used / account.equity));
}

/**
 * Pure account-frame → view mapper (island-testable). Given the request-time
 * account frame it produces the display model; the island calls this after a
 * realtime margin patch to re-render text nodes.
 */
export function toAccountBarView(account: AccountMargin): AccountBarView {
  const ratio = marginUsageRatio(account);
  return {
    equity: formatUsd(account.equity),
    marginUsed: formatUsd(account.used),
    withdrawable: formatUsd(account.free),
    maintenance: formatUsd(account.maintenance),
    marginUsagePct: formatPct(ratio),
    marginUsageRatio: ratio,
    raw: {
      equity: account.equity,
      used: account.used,
      free: account.free,
      maintenance: account.maintenance,
    },
  };
}

/**
 * The leverage-driven margin preview model (C3 flow B). Pure function of
 * `(account, leverage)` — no framework, fully unit-testable and deterministic.
 *
 * Semantics: at leverage `L` the initial margin required to hold the *current*
 * notional (equity's used-margin position, i.e. `used * baseLeverage`) scales as
 * `1 / L`. We model notional as `used * 1` (base leverage 1 = the request-time
 * margin equals notional-at-1x), so:
 *
 *   projectedMargin(L) = used / L
 *   projectedFree(L)   = equity - projectedMargin(L)
 *   projectedUsage(L)  = clamp(projectedMargin(L) / equity, 0, 1)
 *
 * Higher leverage ⇒ less margin locked ⇒ more withdrawable. This is a *preview*
 * (what-if) overlaid on the request-time snapshot; the realtime feed remains the
 * source of truth for the committed numbers.
 */
export type MarginPreview = {
  leverage: number;
  /** Formatted projected margin required at this leverage. */
  projectedMargin: string;
  /** Formatted projected withdrawable at this leverage. */
  projectedWithdrawable: string;
  /** Formatted projected margin usage percent. */
  projectedUsagePct: string;
  /** Projected usage ratio in [0, 1] for the meter var. */
  projectedUsageRatio: number;
  /** Raw projected numbers (for downstream/testing). */
  raw: {
    projectedMargin: number;
    projectedWithdrawable: number;
  };
};

/**
 * Computes the margin preview for a given leverage against an account view.
 * Pure + deterministic. Leverage is clamped to `>= 1` so a zero/negative value
 * cannot divide-by-zero or invert the model.
 */
export function computeMarginPreview(
  view: AccountBarView,
  leverage: number,
): MarginPreview {
  const lev = Number.isFinite(leverage) && leverage >= 1 ? leverage : 1;
  const { equity, used } = view.raw;
  const projectedMargin = used / lev;
  const projectedWithdrawable = equity - projectedMargin;
  const ratio =
    equity <= 0
      ? projectedMargin > 0
        ? 1
        : 0
      : Math.min(1, Math.max(0, projectedMargin / equity));
  return {
    leverage: lev,
    projectedMargin: formatUsd(projectedMargin),
    projectedWithdrawable: formatUsd(projectedWithdrawable),
    projectedUsagePct: formatPct(ratio),
    projectedUsageRatio: ratio,
    raw: { projectedMargin, projectedWithdrawable },
  };
}

// A process-wide cache so the read cache survives across SSR requests, mirroring
// a long-lived server cache. Shared across the fragment.
const sharedCache = new Map<string, DataCacheEntry>();

/**
 * Loads the request-time account frame through the C4 trade data client (which
 * pre-registers the C5 sources and seeds from the frozen mock fixtures). One
 * client per SSR request; `readData` coalesces concurrent reads of the same
 * `account` key so order-form / positions-table share this single resolution.
 */
export async function loadAccountBarData(
  ctx: RequestContext,
  trace?: RequestTrace,
): Promise<AccountBarData> {
  const client = createTradeDataClient({ ctx, cache: sharedCache });

  const accountSpan = trace?.startSpan(`data:${sourceIds.account}`, "data");
  const accountResult = await client.readData<AccountMargin>(
    client.sourceIds.account,
  );
  trace?.endSpan(accountSpan ?? "", { status: "ok" });

  return { account: accountResult.data };
}
