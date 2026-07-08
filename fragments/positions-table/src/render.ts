import type { RequestContext } from "@mvp/contracts";
import type { RequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import { loadPositions, type Position } from "./data";
import { positionsTableManifest } from "./manifest";
import { formatPositionRow, positionKey } from "./patch";
import { positionsTableCss } from "./styles";

export type PositionsTableRenderRequest = {
  ctx?: {
    locale?: string;
    tenant?: string;
    traceId?: string;
    /** Active symbol seed (for the initial row-focus highlight). */
    activeSymbol?: string;
  };
  /** `positions-table` takes the account from ctx; props are optional (doc 02 §2). */
  props?: {
    /** Optional active-symbol override for the initial focus highlight. */
    activeSymbol?: string;
  };
};

export type PositionsTableRenderOptions = {
  /** Active request trace; a render span is recorded when provided. */
  trace?: RequestTrace;
};

function toRequestContext(
  ctx: PositionsTableRenderRequest["ctx"],
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
 * Renders the positions table server-side. The SSR HTML is a server-safe (no
 * React) mono table of the current open positions: symbol, direction, size,
 * entry, mark, liq, and uPnL (with up/down semantic-color classes), plus a
 * per-row close-control placeholder (a real `<button>`, wired client-side).
 * Each row is keyed by `symbol` so the vanilla patch client can upsert / remove
 * in place. An inline island-props snapshot seeds the island for first
 * interactivity without a network round-trip.
 *
 * `positions` is realtime + user-private with no mock generator, so the data
 * plane polls the fixture snapshot; the SSR result is deterministic.
 */
export async function renderPositionsTable(
  request: PositionsTableRenderRequest,
  options: PositionsTableRenderOptions = {},
) {
  const { trace } = options;
  const renderSpan = trace?.startSpan("render:positions-table", "fragment", {
    attributes: { fragment: positionsTableManifest.name },
  });

  try {
    const ctx = toRequestContext(request.ctx);
    const activeSymbolRaw =
      request.props?.activeSymbol ?? request.ctx?.activeSymbol;
    const activeSymbol = activeSymbolRaw
      ? positionKey(activeSymbolRaw)
      : undefined;

    const positions = await loadPositions(ctx);

    trace?.endSpan(renderSpan ?? "", {
      status: "ok",
      attributes: {
        positionCount: positions.length,
        ...(activeSymbol ? { activeSymbol } : {}),
        propsValid: true,
      },
    });

    return {
      statusCode: 200,
      body: {
        html: renderPositionsHtml(positions, activeSymbol),
        assets: positionsTableManifest.assets,
        cache: {
          // Realtime: no TTL. Tags let a position update invalidate this slot.
          ttl: 0,
          tags: ["positions"],
        },
        metadata: {
          name: positionsTableManifest.name,
          version: positionsTableManifest.version,
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
      body: createPositionsTableFallback(
        error instanceof Error ? error.message : "render failed",
      ),
    };
  }
}

/** The server-safe positions markup: a mono table plus the island snapshot. */
export function renderPositionsHtml(
  positions: Position[],
  activeSymbol?: string,
): string {
  const rows = positions
    .map((position) => renderPositionRow(position, activeSymbol))
    .join("");
  const snapshot = JSON.stringify({
    ...(activeSymbol ? { activeSymbol } : {}),
    positions,
  });
  const body =
    rows.length > 0
      ? rows
      : `<tr class="pt-empty"><td colspan="8">No open positions</td></tr>`;
  return (
    `<style data-fragment-style="positions-table">${positionsTableCss}</style>` +
    `<section class="pt" data-fragment="positions-table" data-island="positions">` +
    `<div class="pt-scroll">` +
    `<table class="pt-table" role="table" aria-label="Open positions">` +
    `<thead><tr class="pt-head" role="row">` +
    `<th class="pt-col pt-col--symbol" scope="col">Symbol</th>` +
    `<th class="pt-col pt-col--side" scope="col">Side</th>` +
    `<th class="pt-col pt-col--num" scope="col">Size</th>` +
    `<th class="pt-col pt-col--num" scope="col">Entry</th>` +
    `<th class="pt-col pt-col--num" scope="col">Mark</th>` +
    `<th class="pt-col pt-col--num" scope="col">Liq.</th>` +
    `<th class="pt-col pt-col--num" scope="col">uPnL</th>` +
    `<th class="pt-col pt-col--action" scope="col">Close</th>` +
    `</tr></thead>` +
    `<tbody data-positions-body>${body}</tbody>` +
    `</table>` +
    `</div>` +
    `<script type="application/json" data-island-props="positions">${escapeJsonForScript(snapshot)}</script>` +
    `</section>`
  );
}

/**
 * One position row, keyed by `symbol`, direction-tagged, uPnL colored by sign
 * via `pt-pnl--up` / `pt-pnl--down`, with a close-control placeholder button.
 */
export function renderPositionRow(
  position: Position,
  activeSymbol?: string,
): string {
  const key = positionKey(position.symbol);
  const cells = formatPositionRow(position);
  const isActive = activeSymbol !== undefined && key === activeSymbol;
  return (
    `<tr class="pt-row pt-row--${cells.direction}${isActive ? " is-active" : ""}"` +
    ` data-symbol="${escapeAttr(key)}" data-direction="${cells.direction}"` +
    `${isActive ? ' data-active="true"' : ""} role="row">` +
    `<td class="pt-cell pt-cell--symbol" data-field="symbol">${escapeText(key)}</td>` +
    `<td class="pt-cell pt-cell--side pt-side--${cells.direction}" data-field="direction">${cells.direction === "short" ? "SHORT" : "LONG"}</td>` +
    `<td class="pt-cell pt-cell--num" data-field="size">${escapeText(cells.size)}</td>` +
    `<td class="pt-cell pt-cell--num" data-field="entry">${escapeText(cells.entry)}</td>` +
    `<td class="pt-cell pt-cell--num" data-field="mark">${escapeText(cells.mark)}</td>` +
    `<td class="pt-cell pt-cell--num" data-field="liq">${escapeText(cells.liq)}</td>` +
    `<td class="pt-cell pt-cell--num pt-pnl pt-pnl--${cells.pnlSign}" data-field="pnl" data-sign="${cells.pnlSign}">${escapeText(cells.pnl)}</td>` +
    `<td class="pt-cell pt-cell--action">` +
    `<button type="button" class="pt-close" data-action="close" data-symbol="${escapeAttr(key)}" aria-label="Close ${escapeAttr(key)} position">Close</button>` +
    `</td>` +
    `</tr>`
  );
}

export function createPositionsTableFallback(reason: string) {
  return {
    html: `<section data-fragment="positions-table" data-fallback="true">Positions unavailable: ${escapeText(reason)}</section>`,
    assets: { js: [], css: [] },
    cache: { ttl: 0, tags: ["positions", "fallback"] },
    metadata: {
      name: positionsTableManifest.name,
      version: positionsTableManifest.version,
    },
  };
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

/** Neutralizes `</script>` so the inline JSON snapshot cannot break out. */
function escapeJsonForScript(json: string): string {
  return json.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
}
