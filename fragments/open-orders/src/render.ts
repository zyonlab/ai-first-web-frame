import type { RequestContext } from "@mvp/contracts";
import type { RequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import { loadOpenOrders } from "./data";
import { openOrdersManifest } from "./manifest";
import { formatOrderRow, type OpenOrder, toOpenOrder } from "./patch";

export type OpenOrdersRenderRequest = {
  ctx?: {
    locale?: string;
    tenant?: string;
    traceId?: string;
  };
  props?: {
    /** Active symbol to scope the working-orders view to. Defaults to BTC. */
    symbol?: string;
  };
};

export type OpenOrdersRenderOptions = {
  /** Active request trace; a render span is recorded when provided. */
  trace?: RequestTrace;
};

function toRequestContext(ctx: OpenOrdersRenderRequest["ctx"]): RequestContext {
  return createRequestContext({
    headers: {
      "x-locale": ctx?.locale ?? "en-US",
      "x-tenant": ctx?.tenant ?? "default",
      ...(ctx?.traceId ? { "x-trace-id": ctx.traceId } : {}),
    },
  });
}

/**
 * Renders the open (working) orders table server-side. The SSR HTML is a
 * server-safe (no React) mono table of the current working orders scoped to the
 * active symbol, each row keyed by `orderId` so the vanilla patch client can
 * upsert/remove in place and drive cancels. An inline island-props snapshot
 * seeds the island for first interactivity without a network round-trip.
 */
export async function renderOpenOrders(
  request: OpenOrdersRenderRequest,
  options: OpenOrdersRenderOptions = {},
) {
  const { trace } = options;
  const renderSpan = trace?.startSpan("render:open-orders", "fragment", {
    attributes: { fragment: openOrdersManifest.name },
  });

  if (!request.props) {
    trace?.endSpan(renderSpan ?? "", {
      status: "fallback",
      attributes: { reason: "missing props", propsValid: false },
    });
    return {
      statusCode: 400,
      body: createOpenOrdersFallback("missing props"),
    };
  }

  try {
    const ctx = toRequestContext(request.ctx);
    const symbol = (
      (request.props.symbol ?? "BTC").trim() || "BTC"
    ).toUpperCase();

    const working = await loadOpenOrders(ctx);
    const orders = working.map(toOpenOrder).filter((o) => o.symbol === symbol);

    trace?.endSpan(renderSpan ?? "", {
      status: "ok",
      attributes: {
        symbol,
        orderCount: orders.length,
        propsValid: true,
      },
    });

    return {
      statusCode: 200,
      body: {
        html: renderOrdersHtml(symbol, orders),
        assets: openOrdersManifest.assets,
        cache: {
          // User-private realtime: no TTL. Tags let a symbol switch / order
          // mutation invalidate this slot.
          ttl: 0,
          tags: ["orders"],
        },
        metadata: {
          name: openOrdersManifest.name,
          version: openOrdersManifest.version,
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
      body: createOpenOrdersFallback(
        error instanceof Error ? error.message : "render failed",
      ),
    };
  }
}

/** The server-safe orders markup: a mono table plus the island-props snapshot. */
export function renderOrdersHtml(symbol: string, orders: OpenOrder[]): string {
  const rows = orders.map((order) => renderOrderRow(order)).join("");
  const body =
    rows ||
    `<tr class="oo-empty" data-oo-empty><td colspan="6">No open orders</td></tr>`;
  const snapshot = JSON.stringify({ symbol, orders });
  return (
    `<section data-fragment="open-orders" data-island="openOrders" data-symbol="${escapeHtml(symbol)}">` +
    `<table class="oo-table" role="table">` +
    `<thead><tr class="oo-head">` +
    `<th class="oo-col oo-col--symbol" scope="col">Symbol</th>` +
    `<th class="oo-col oo-col--side" scope="col">Side</th>` +
    `<th class="oo-col oo-col--type" scope="col">Type</th>` +
    `<th class="oo-col oo-col--price" scope="col">Price</th>` +
    `<th class="oo-col oo-col--size" scope="col">Size</th>` +
    `<th class="oo-col oo-col--filled" scope="col">Filled</th>` +
    `<th class="oo-col oo-col--action" scope="col"></th>` +
    `</tr></thead>` +
    `<tbody data-orders-body>${body}</tbody>` +
    `</table>` +
    `<script type="application/json" data-island-props="openOrders">${escapeJsonForScript(snapshot)}</script>` +
    `</section>`
  );
}

/**
 * One order row, keyed by `orderId`, colored by side, ending in a cancel-control
 * placeholder. The cancel control is a real `<button>` carrying the data
 * attributes the island's cancel flow reads; SSR has no JS wired, so it is inert
 * until the island binds it (no-JS readable table, cancel simply does nothing).
 */
export function renderOrderRow(order: OpenOrder): string {
  const cells = formatOrderRow(order);
  return (
    `<tr class="oo-row oo-row--${order.side}" data-order-id="${escapeHtml(order.orderId)}" data-symbol="${escapeHtml(order.symbol)}" data-side="${order.side}">` +
    `<td class="oo-cell oo-cell--symbol">${escapeHtml(order.symbol)}</td>` +
    `<td class="oo-cell oo-cell--side" data-side="${order.side}">${escapeHtml(cells.side)}</td>` +
    `<td class="oo-cell oo-cell--type">${escapeHtml(cells.type)}</td>` +
    `<td class="oo-cell oo-cell--price">${escapeHtml(cells.price)}</td>` +
    `<td class="oo-cell oo-cell--size">${escapeHtml(cells.size)}</td>` +
    `<td class="oo-cell oo-cell--filled">${escapeHtml(cells.filled)}</td>` +
    `<td class="oo-cell oo-cell--action">` +
    `<button type="button" class="oo-cancel" data-oo-cancel data-order-id="${escapeHtml(order.orderId)}" data-symbol="${escapeHtml(order.symbol)}" aria-label="Cancel order ${escapeHtml(order.orderId)}">Cancel</button>` +
    `</td>` +
    `</tr>`
  );
}

export function createOpenOrdersFallback(reason: string) {
  return {
    html: `<section data-fragment="open-orders" data-fallback="true">Open orders unavailable: ${escapeHtml(reason)}</section>`,
    assets: { js: [], css: [] },
    cache: { ttl: 0, tags: ["orders", "fallback"] },
    metadata: {
      name: openOrdersManifest.name,
      version: openOrdersManifest.version,
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Neutralizes `</script>` so the inline JSON snapshot cannot break out. */
function escapeJsonForScript(json: string): string {
  return json.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
}
