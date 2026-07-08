import type { RequestContext } from "@mvp/contracts";
import type { RequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import { loadMarketsSnapshot, type MarketsTableSnapshot } from "./data";
import {
  changeDirection,
  formatChangePct,
  formatFundingRate,
  formatPrice,
  formatVolume,
  tradeHref,
} from "./format";
import { marketsTableManifest } from "./manifest";
import { marketsTableCss } from "./styles";

export type MarketsTableRenderRequest = {
  ctx?: {
    locale?: string;
    tenant?: string;
    traceId?: string;
  };
  props?: {
    /** Optional sort key; the SSR snapshot renders index order otherwise. */
    sort?: "symbol" | "changePct24h" | "volume24h";
    /** Optional case-insensitive symbol filter substring. */
    filter?: string;
  };
};

export type MarketsTableRenderOptions = {
  /** Active request trace; a render span is recorded when provided. */
  trace?: RequestTrace;
};

function toRequestContext(
  ctx: MarketsTableRenderRequest["ctx"],
): RequestContext {
  return createRequestContext({
    headers: {
      "x-locale": ctx?.locale ?? "en-US",
      "x-tenant": ctx?.tenant ?? "default",
      ...(ctx?.traceId ? { "x-trace-id": ctx.traceId } : {}),
    },
  });
}

export async function renderMarketsTable(
  request: MarketsTableRenderRequest,
  options: MarketsTableRenderOptions = {},
) {
  const { trace } = options;
  const renderSpan = trace?.startSpan("render:markets-table", "fragment", {
    attributes: { fragment: marketsTableManifest.name },
  });

  try {
    const ctx = toRequestContext(request.ctx);
    const snapshot = await loadMarketsSnapshot(ctx, trace);
    const view = applyView(snapshot, request.props);

    trace?.endSpan(renderSpan ?? "", {
      status: "ok",
      attributes: {
        rows: view.rows.length,
        propsValid: true,
      },
    });

    return {
      statusCode: 200,
      body: {
        html: renderMarketsTableHtml(view),
        assets: marketsTableManifest.assets,
        cache: {
          ttl: marketsTableManifest.cachePolicy.ttl,
          tags: ["markets", "markets:index"],
        },
        metadata: {
          name: marketsTableManifest.name,
          version: marketsTableManifest.version,
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
      body: createMarketsTableFallback(
        error instanceof Error ? error.message : "render failed",
      ),
    };
  }
}

/** Applies the optional client-parity filter + sort to the snapshot rows. */
export function applyView(
  snapshot: MarketsTableSnapshot,
  props: MarketsTableRenderRequest["props"] = {},
): MarketsTableSnapshot {
  let rows = snapshot.rows;
  const filter = props.filter?.trim().toUpperCase();
  if (filter) {
    rows = rows.filter((row) => row.symbol.toUpperCase().includes(filter));
  }
  if (props.sort === "symbol") {
    rows = [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol));
  } else if (props.sort === "changePct24h") {
    rows = [...rows].sort((a, b) => b.changePct24h - a.changePct24h);
  } else if (props.sort === "volume24h") {
    rows = [...rows].sort((a, b) => b.volume24h - a.volume24h);
  }
  return { rows, ts: snapshot.ts };
}

/**
 * Builds the server-safe markets table HTML. Pure string output (no React):
 * a semantic `<table>` whose every row is a deep-link `<a href="/trade/SYMBOL">`
 * so the list is navigable with no JS. Numeric cells use tabular-nums via CSS
 * and carry `data-*` hooks (`data-mark`, `data-change-direction`) for an
 * optional vanilla price-tick patch.
 */
export function renderMarketsTableHtml(snapshot: MarketsTableSnapshot): string {
  const rows = snapshot.rows.map((row) => renderRow(row)).join("");
  return (
    `<style data-fragment-style="markets-table">${marketsTableCss}</style>` +
    `<section data-fragment="markets-table" data-row-count="${snapshot.rows.length}">` +
    `<table class="markets-table">` +
    `<thead><tr class="markets-table__head">` +
    `<th class="markets-table__col markets-table__col--symbol" scope="col">Symbol</th>` +
    `<th class="markets-table__col markets-table__col--num" scope="col">Last</th>` +
    `<th class="markets-table__col markets-table__col--num" scope="col">24h %</th>` +
    `<th class="markets-table__col markets-table__col--num" scope="col">Funding</th>` +
    `<th class="markets-table__col markets-table__col--num" scope="col">Volume(24h)</th>` +
    `<th class="markets-table__col markets-table__col--action" scope="col">Trade</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table>` +
    `</section>`
  );
}

function renderRow(row: {
  symbol: string;
  mark: number;
  last: number;
  changePct24h: number;
  funding: number;
  volume24h: number;
}): string {
  const symbol = escapeHtml(row.symbol);
  const href = escapeHtml(tradeHref(row.symbol));
  const changeDir = changeDirection(row.changePct24h);
  const fundingDir = changeDirection(row.funding);
  const changeLabel = escapeHtml(formatChangePct(row.changePct24h));
  const fundingLabel = escapeHtml(formatFundingRate(row.funding));
  const lastLabel = escapeHtml(formatPrice(row.last));
  const volumeLabel = escapeHtml(formatVolume(row.volume24h));

  // The whole row is a deep link: an <a> spanning the row via display:contents
  // in CSS keeps it a single tab stop and a real navigation target with no JS.
  return (
    `<tr class="markets-table__row" data-symbol="${symbol}" data-mark="${row.mark}">` +
    `<td class="markets-table__cell markets-table__cell--symbol">` +
    `<a class="markets-table__link" href="${href}" data-trade-link="${symbol}">${symbol}</a>` +
    `</td>` +
    `<td class="markets-table__cell markets-table__cell--num" data-last="${row.last}">${lastLabel}</td>` +
    `<td class="markets-table__cell markets-table__cell--num markets-table__change--${changeDir}" data-change-direction="${changeDir}">${changeLabel}</td>` +
    `<td class="markets-table__cell markets-table__cell--num markets-table__change--${fundingDir}" data-funding-direction="${fundingDir}">${fundingLabel}</td>` +
    `<td class="markets-table__cell markets-table__cell--num" data-volume="${row.volume24h}">${volumeLabel}</td>` +
    `<td class="markets-table__cell markets-table__cell--action">` +
    `<a class="markets-table__trade" href="${href}" aria-label="Trade ${symbol}">&rarr;</a>` +
    `</td>` +
    `</tr>`
  );
}

export function createMarketsTableFallback(reason: string) {
  return {
    html: `<section data-fragment="markets-table" data-fallback="true">Markets unavailable: ${escapeHtml(reason)}</section>`,
    assets: { js: [], css: [] },
    cache: { ttl: 5, tags: ["markets", "fallback"] },
    metadata: {
      name: marketsTableManifest.name,
      version: marketsTableManifest.version,
    },
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
