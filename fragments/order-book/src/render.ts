import type { RequestContext } from "@mvp/contracts";
import type { RequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import { loadOrderbookSnapshot } from "./data";
import {
  buildLadder,
  formatPrice,
  formatSize,
  type Ladder,
  type LadderRow,
} from "./ladder";
import { orderBookManifest } from "./manifest";
import { orderBookCss } from "./styles";

export type OrderBookRenderRequest = {
  ctx?: {
    locale?: string;
    tenant?: string;
    traceId?: string;
  };
  props?: {
    symbol?: string;
    grouping?: number;
    depth?: number;
  };
};

export type OrderBookRenderOptions = {
  /** Active request trace; a render span is recorded when provided. */
  trace?: RequestTrace;
};

/** Default per-side depth for the desktop ladder (doc 01 §1.4). */
const DEFAULT_DEPTH = 12;
const GROUPINGS = [0.5, 1, 5, 10] as const;

function toRequestContext(ctx: OrderBookRenderRequest["ctx"]): RequestContext {
  return createRequestContext({
    headers: {
      "x-locale": ctx?.locale ?? "en-US",
      "x-tenant": ctx?.tenant ?? "default",
      ...(ctx?.traceId ? { "x-trace-id": ctx.traceId } : {}),
    },
  });
}

export async function renderOrderBook(
  request: OrderBookRenderRequest,
  options: OrderBookRenderOptions = {},
) {
  const { trace } = options;
  const renderSpan = trace?.startSpan("render:order-book", "fragment", {
    attributes: { fragment: orderBookManifest.name },
  });

  const symbol = request.props?.symbol;
  if (!request.props || typeof symbol !== "string" || symbol.trim() === "") {
    trace?.endSpan(renderSpan ?? "", {
      status: "fallback",
      attributes: { reason: "missing props", propsValid: false },
    });
    return {
      statusCode: 400,
      body: createOrderBookFallback("missing symbol prop"),
    };
  }

  try {
    const ctx = toRequestContext(request.ctx);
    const grouping = normalizeGrouping(request.props.grouping);
    const depth = normalizeDepth(request.props.depth);

    const frame = await loadOrderbookSnapshot(ctx, symbol);
    const ladder = buildLadder(frame, depth);
    const html = renderLadderHtml(ladder, { grouping });

    trace?.endSpan(renderSpan ?? "", {
      status: "ok",
      attributes: {
        symbol: ladder.symbol,
        grouping,
        depth,
        seq: ladder.seq,
        propsValid: true,
      },
    });

    return {
      statusCode: 200,
      body: {
        html,
        assets: orderBookManifest.assets,
        cache: { ttl: 0, tags: ["book", `book:${ladder.symbol}`] },
        metadata: {
          name: orderBookManifest.name,
          version: orderBookManifest.version,
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
      body: createOrderBookFallback(
        error instanceof Error ? error.message : "render failed",
      ),
    };
  }
}

/**
 * Renders the full server-safe HTML: a mount node with an inline JSON snapshot
 * (C2), grouping chips, a header row, ask ladder (worst→best top-down), the
 * spread strip, and bid ladder. Numeric cells carry stable `data-price` keys so
 * the vanilla island patches them in place. No React.
 */
export function renderLadderHtml(
  ladder: Ladder,
  opts: { grouping: number },
): string {
  const snapshot = {
    props: {
      symbol: ladder.symbol,
      grouping: opts.grouping,
      seq: ladder.seq,
      levels: {
        bids: ladder.bids.map((r) => ({ price: r.price, size: r.size })),
        asks: ladder.asks.map((r) => ({ price: r.price, size: r.size })),
      },
    },
    slice: "orderDraft",
  };

  // Asks render worst-first (top) → best-first (near spread), matching the
  // reference book layout where the best ask sits just above the spread strip.
  const askRows = [...ladder.asks]
    .reverse()
    .map((r) => rowHtml(r))
    .join("");
  const bidRows = ladder.bids.map((r) => rowHtml(r)).join("");

  return [
    `<style data-fragment-style="order-book">${orderBookCss}</style>`,
    `<section class="ob" data-fragment="order-book" data-symbol="${escapeAttr(ladder.symbol)}" data-seq="${ladder.seq}">`,
    `<div data-island="book">`,
    `<div class="ob-grouping" role="group" aria-label="Tick grouping">`,
    GROUPINGS.map(
      (g) =>
        `<button type="button" class="ob-chip${g === opts.grouping ? " is-active" : ""}" data-grouping="${g}" aria-pressed="${g === opts.grouping}">${g}</button>`,
    ).join(""),
    `</div>`,
    `<table class="ob-table" role="grid" aria-label="Order book for ${escapeAttr(ladder.symbol)}">`,
    `<thead><tr class="ob-head" role="row"><th scope="col">Price</th><th scope="col">Size</th><th scope="col">Total</th></tr></thead>`,
    `<tbody class="ob-asks" data-side="ask">${askRows}</tbody>`,
    `<tbody class="ob-spread"><tr role="row"><td colspan="3"><span class="ob-spread-label">Spread</span> <span data-field="spread">${escapeText(formatPrice(ladder.spread))}</span> <span data-field="spread-pct">(${ladder.spreadPct.toFixed(3)}%)</span> <span class="ob-mid">mid <span data-field="mid">${escapeText(formatPrice(ladder.mid))}</span></span></td></tr></tbody>`,
    `<tbody class="ob-bids" data-side="bid">${bidRows}</tbody>`,
    `</table>`,
    `<script type="application/json" data-island-props="book">${escapeJson(JSON.stringify(snapshot))}</script>`,
    `</div>`,
    `</section>`,
  ].join("");
}

function rowHtml(row: LadderRow): string {
  const depthPct = (row.depth * 100).toFixed(2);
  return [
    `<tr class="ob-row ob-${row.side}" role="row" tabindex="0"`,
    ` data-price="${escapeAttr(row.key)}" data-side="${row.side}"`,
    ` style="--depth:${depthPct}%">`,
    `<td class="ob-price" data-field="price" data-value="${row.price}">${escapeText(formatPrice(row.price))}</td>`,
    `<td class="ob-num" data-field="size">${escapeText(formatSize(row.size))}</td>`,
    `<td class="ob-num" data-field="total">${escapeText(formatSize(row.total))}</td>`,
    `</tr>`,
  ].join("");
}

export function createOrderBookFallback(reason: string) {
  return {
    html: `<section data-fragment="order-book" data-fallback="true">Order book unavailable: ${escapeText(reason)}</section>`,
    assets: { js: [], css: [] },
    cache: { ttl: 0, tags: ["book", "fallback"] },
    metadata: {
      name: orderBookManifest.name,
      version: orderBookManifest.version,
      // Contract flag: marks this response as a degraded fallback.
      fallback: true,
    },
  };
}

function normalizeGrouping(value: unknown): number {
  const n = Number(value);
  return (GROUPINGS as readonly number[]).includes(n) ? n : 1;
}

function normalizeDepth(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DEPTH;
  return Math.min(n, 50);
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

/** Neutralizes `</script>` so the inline JSON snapshot can't break out. */
function escapeJson(value: string): string {
  return value.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
}
