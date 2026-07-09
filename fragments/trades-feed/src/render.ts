import type { RequestContext } from "@mvp/contracts";
import type { TradePrintFrame } from "@mvp/data";
import type { RequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import { loadRecentTrades } from "./data";
import { tradesFeedManifest } from "./manifest";
import {
  DEFAULT_TRADES_LIMIT,
  formatPrintRow,
  MAX_TRADES_LIMIT,
} from "./patch";
import { tradesFeedCss } from "./styles";

export type TradesFeedRenderRequest = {
  ctx?: {
    locale?: string;
    tenant?: string;
    traceId?: string;
  };
  props?: {
    symbol?: string;
    limit?: number;
  };
};

export type TradesFeedRenderOptions = {
  /** Active request trace; a render span is recorded when provided. */
  trace?: RequestTrace;
};

function toRequestContext(ctx: TradesFeedRenderRequest["ctx"]): RequestContext {
  return createRequestContext({
    headers: {
      "x-locale": ctx?.locale ?? "en-US",
      "x-tenant": ctx?.tenant ?? "default",
      ...(ctx?.traceId ? { "x-trace-id": ctx.traceId } : {}),
    },
  });
}

/** Clamps a requested limit into the sane [1, MAX] range with a default. */
function resolveLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_TRADES_LIMIT;
  }
  const rounded = Math.floor(limit);
  if (rounded < 1) return 1;
  if (rounded > MAX_TRADES_LIMIT) return MAX_TRADES_LIMIT;
  return rounded;
}

/**
 * Renders the trades tape server-side. The SSR HTML is a server-safe (no React)
 * mono table of the most recent prints, newest first, each row keyed by its
 * stream `seq` so the vanilla patch client can prepend/trim in place. An inline
 * island-props snapshot seeds the island for first interactivity without a
 * network round-trip.
 */
export async function renderTradesFeed(
  request: TradesFeedRenderRequest,
  options: TradesFeedRenderOptions = {},
) {
  const { trace } = options;
  const renderSpan = trace?.startSpan("render:trades-feed", "fragment", {
    attributes: { fragment: tradesFeedManifest.name },
  });

  if (!request.props) {
    trace?.endSpan(renderSpan ?? "", {
      status: "fallback",
      attributes: { reason: "missing props", propsValid: false },
    });
    return {
      statusCode: 400,
      body: createTradesFeedFallback("missing props"),
    };
  }

  try {
    const ctx = toRequestContext(request.ctx);
    const symbol = (request.props.symbol ?? "BTC").trim() || "BTC";
    const limit = resolveLimit(request.props.limit);

    const tape = await loadRecentTrades(ctx, symbol);
    // Newest first; cap to the requested limit (the tape length ceiling).
    const prints = [...tape].sort((a, b) => b.seq - a.seq).slice(0, limit);

    trace?.endSpan(renderSpan ?? "", {
      status: "ok",
      attributes: {
        symbol,
        limit,
        printCount: prints.length,
        propsValid: true,
      },
    });

    const normalizedSymbol = prints[0]?.symbol ?? symbol.toUpperCase();

    return {
      statusCode: 200,
      body: {
        html: renderTapeHtml(normalizedSymbol, limit, prints),
        assets: tradesFeedManifest.assets,
        cache: {
          // Realtime: no TTL. Tags let a symbol switch invalidate this slot.
          ttl: 0,
          tags: ["trades", `trades:${normalizedSymbol}`],
        },
        metadata: {
          name: tradesFeedManifest.name,
          version: tradesFeedManifest.version,
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
      body: createTradesFeedFallback(
        error instanceof Error ? error.message : "render failed",
      ),
    };
  }
}

/** The server-safe tape markup: a mono table plus the island-props snapshot. */
export function renderTapeHtml(
  symbol: string,
  limit: number,
  prints: TradePrintFrame[],
): string {
  const rows = prints.map((print) => renderTapeRow(print)).join("");
  const snapshot = JSON.stringify({ symbol, limit, prints });
  return (
    `<style data-fragment-style="trades-feed">${tradesFeedCss}</style>` +
    `<section data-fragment="trades-feed" data-island="trades" data-symbol="${escapeHtml(symbol)}" data-limit="${limit}">` +
    `<table class="trades-tape" role="table">` +
    `<thead><tr class="trades-tape__head">` +
    `<th class="trades-tape__col trades-tape__col--time" scope="col">Time</th>` +
    `<th class="trades-tape__col trades-tape__col--price" scope="col">Price</th>` +
    `<th class="trades-tape__col trades-tape__col--size" scope="col">Size</th>` +
    `</tr></thead>` +
    `<tbody data-trades-body>${rows}</tbody>` +
    `</table>` +
    `<script type="application/json" data-island-props="trades">${escapeJsonForScript(snapshot)}</script>` +
    `</section>`
  );
}

/** One tape row, keyed by stream `seq`, colored by aggressor side. */
export function renderTapeRow(print: TradePrintFrame): string {
  const cells = formatPrintRow(print);
  return (
    `<tr class="trades-tape__row trades-tape__row--${print.side}" data-seq="${print.seq}" data-side="${print.side}">` +
    `<td class="trades-tape__cell trades-tape__cell--time">${escapeHtml(cells.time)}</td>` +
    `<td class="trades-tape__cell trades-tape__cell--price" data-side="${print.side}">${escapeHtml(cells.price)}</td>` +
    `<td class="trades-tape__cell trades-tape__cell--size">${escapeHtml(cells.size)}</td>` +
    `</tr>`
  );
}

export function createTradesFeedFallback(reason: string) {
  return {
    html: `<section data-fragment="trades-feed" data-fallback="true">Trades feed unavailable: ${escapeHtml(reason)}</section>`,
    assets: { js: [], css: [] },
    cache: { ttl: 0, tags: ["trades", "fallback"] },
    metadata: {
      name: tradesFeedManifest.name,
      version: tradesFeedManifest.version,
      // Contract flag: marks this response as a degraded fallback.
      fallback: true,
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
