import type { RequestContext } from "@mvp/contracts";
import type { RequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import { loadPortfolioSnapshot, type PortfolioSnapshot } from "./data";
import { portfolioSummaryManifest } from "./manifest";
import { portfolioSummaryCss } from "./styles";
import {
  formatPositionRow,
  type PortfolioOverview,
  toPortfolioOverview,
} from "./view";

export type PortfolioSummaryRenderRequest = {
  ctx?: {
    locale?: string;
    tenant?: string;
    traceId?: string;
  };
  /** `portfolio-summary` takes the account from ctx; props are optional (doc 02 §2). */
  props?: Record<string, never>;
};

export type PortfolioSummaryRenderOptions = {
  /** Active request trace; a render span is recorded when provided. */
  trace?: RequestTrace;
};

function toRequestContext(
  ctx: PortfolioSummaryRenderRequest["ctx"],
): RequestContext {
  return createRequestContext({
    headers: {
      "x-locale": ctx?.locale ?? "en-US",
      "x-tenant": ctx?.tenant ?? "default",
      ...(ctx?.traceId ? { "x-trace-id": ctx.traceId } : {}),
    },
  });
}

/**
 * Renders the portfolio summary server-side. The SSR HTML is server-safe (no
 * React): four overview cards (total equity, unrealized PnL with up/down
 * semantic color, margin usage with a meter, withdrawable) plus a mono
 * open-positions table (symbol → `/trade/<SYMBOL>` deep link, direction, size,
 * entry, mark, uPnL colored by sign). No-JS readable; there is no island.
 *
 * All three sources (`account`, `positions`, `balances`) are read through one
 * shared C4 client; the result is deterministic from the frozen fixtures.
 */
export async function renderPortfolioSummary(
  request: PortfolioSummaryRenderRequest,
  options: PortfolioSummaryRenderOptions = {},
) {
  const { trace } = options;
  const renderSpan = trace?.startSpan("render:portfolio-summary", "fragment", {
    attributes: { fragment: portfolioSummaryManifest.name },
  });

  try {
    const ctx = toRequestContext(request.ctx);
    const snapshot = await loadPortfolioSnapshot(ctx, trace);

    trace?.endSpan(renderSpan ?? "", {
      status: "ok",
      attributes: {
        equity: snapshot.balances.equity,
        unrealizedPnl: snapshot.balances.unrealizedPnl,
        positionCount: snapshot.positions.length,
        propsValid: true,
      },
    });

    return {
      statusCode: 200,
      body: {
        html: renderPortfolioSummaryHtml(snapshot),
        assets: portfolioSummaryManifest.assets,
        cache: {
          // Request-time, user-private: no TTL. Tags let an account / positions
          // update invalidate this slot.
          ttl: 0,
          tags: ["account", "positions", "balances"],
        },
        metadata: {
          name: portfolioSummaryManifest.name,
          version: portfolioSummaryManifest.version,
        },
      },
    };
  } catch (error) {
    trace?.endSpan(renderSpan ?? "", {
      status: "error",
      attributes: {
        error: error instanceof Error ? error.message : "render failed",
      },
    });
    return {
      statusCode: 200,
      body: createPortfolioSummaryFallback(
        error instanceof Error ? error.message : "render failed",
      ),
    };
  }
}

/** The server-safe portfolio markup: overview cards + positions table. */
export function renderPortfolioSummaryHtml(
  snapshot: PortfolioSnapshot,
): string {
  const overview = toPortfolioOverview(snapshot.account, snapshot.balances);
  return (
    `<style data-fragment-style="portfolio-summary">${portfolioSummaryCss}</style>` +
    `<section class="ps" data-fragment="portfolio-summary">` +
    renderOverviewCards(overview) +
    renderPositionsTable(snapshot.positions) +
    `</section>`
  );
}

/** The four overview stat cards row. */
export function renderOverviewCards(overview: PortfolioOverview): string {
  const usagePct = clampRatio(overview.marginUsageRatio);
  return (
    `<div class="ps-cards" role="group" aria-label="Portfolio overview">` +
    renderCard("Equity", overview.equity) +
    renderCard(
      "Unrealized PnL",
      overview.unrealizedPnl,
      `ps-value--${overview.unrealizedPnlSign}`,
      { sign: overview.unrealizedPnlSign },
    ) +
    renderMarginCard(overview.marginUsagePct, overview.marginUsed, usagePct) +
    renderCard("Withdrawable", overview.withdrawable) +
    `</div>`
  );
}

function renderCard(
  label: string,
  value: string,
  valueClass = "",
  data: { sign?: string } = {},
): string {
  const cls = valueClass ? ` ${valueClass}` : "";
  const signAttr = data.sign ? ` data-sign="${escapeAttr(data.sign)}"` : "";
  return (
    `<div class="ps-card">` +
    `<span class="ps-card__label">${escapeText(label)}</span>` +
    `<span class="ps-card__value${cls}"${signAttr}>${escapeText(value)}</span>` +
    `</div>`
  );
}

/** The margin-usage card carries a CSS meter driven by the `--usage` var. */
function renderMarginCard(
  pct: string,
  used: string,
  usageRatio: number,
): string {
  return (
    `<div class="ps-card ps-card--margin">` +
    `<span class="ps-card__label">Margin Usage</span>` +
    `<span class="ps-card__value" data-margin-used="${escapeAttr(used)}">${escapeText(pct)}</span>` +
    `<span class="ps-meter" role="meter" aria-label="Margin usage" aria-valuenow="${(usageRatio * 100).toFixed(2)}" aria-valuemin="0" aria-valuemax="100" style="--usage:${usageRatio.toFixed(4)}">` +
    `<span class="ps-meter__fill"></span>` +
    `</span>` +
    `</div>`
  );
}

/** The open-positions table: symbol deep-link, side, size, entry, mark, uPnL. */
export function renderPositionsTable(
  positions: Parameters<typeof renderPositionRow>[0][],
): string {
  const rows = positions
    .map((position) => renderPositionRow(position))
    .join("");
  const body =
    rows.length > 0
      ? rows
      : `<tr class="ps-empty"><td colspan="6">No open positions</td></tr>`;
  return (
    `<div class="ps-scroll">` +
    `<table class="ps-table" role="table" aria-label="Open positions">` +
    `<thead><tr class="ps-head" role="row">` +
    `<th class="ps-col ps-col--symbol" scope="col">Symbol</th>` +
    `<th class="ps-col ps-col--side" scope="col">Side</th>` +
    `<th class="ps-col ps-col--num" scope="col">Size</th>` +
    `<th class="ps-col ps-col--num" scope="col">Entry</th>` +
    `<th class="ps-col ps-col--num" scope="col">Mark</th>` +
    `<th class="ps-col ps-col--num" scope="col">uPnL</th>` +
    `</tr></thead>` +
    `<tbody>${body}</tbody>` +
    `</table>` +
    `</div>`
  );
}

/** One position row; symbol is a `/trade/<SYMBOL>` deep link. */
export function renderPositionRow(
  position: Parameters<typeof formatPositionRow>[0],
): string {
  const cells = formatPositionRow(position);
  return (
    `<tr class="ps-row ps-row--${cells.direction}" data-symbol="${escapeAttr(cells.symbol)}" data-direction="${cells.direction}" role="row">` +
    `<td class="ps-cell ps-cell--symbol" data-field="symbol">` +
    `<a class="ps-link" href="${escapeAttr(cells.href)}">${escapeText(cells.symbol)}</a>` +
    `</td>` +
    `<td class="ps-cell ps-cell--side ps-side--${cells.direction}" data-field="direction">${cells.direction === "short" ? "SHORT" : "LONG"}</td>` +
    `<td class="ps-cell ps-cell--num" data-field="size">${escapeText(cells.size)}</td>` +
    `<td class="ps-cell ps-cell--num" data-field="entry">${escapeText(cells.entry)}</td>` +
    `<td class="ps-cell ps-cell--num" data-field="mark">${escapeText(cells.mark)}</td>` +
    `<td class="ps-cell ps-cell--num ps-pnl ps-pnl--${cells.pnlSign}" data-field="pnl" data-sign="${cells.pnlSign}">${escapeText(cells.pnl)}</td>` +
    `</tr>`
  );
}

export function createPortfolioSummaryFallback(reason: string) {
  return {
    html: `<section data-fragment="portfolio-summary" data-fallback="true">Portfolio unavailable: ${escapeText(reason)}</section>`,
    assets: { js: [], css: [] },
    cache: { ttl: 0, tags: ["account", "positions", "balances", "fallback"] },
    metadata: {
      name: portfolioSummaryManifest.name,
      version: portfolioSummaryManifest.version,
    },
  };
}

/** Clamps a ratio into [0, 1] for the meter var. */
function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, ratio));
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}
