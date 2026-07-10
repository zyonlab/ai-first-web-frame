import type { RequestContext } from "@mvp/contracts";
import type { DataCacheEntry } from "@mvp/data";
import type { RequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import { TRADE_ORDER_DRAFT } from "@mvp/trade-contracts";
import { type AccountMargin, loadAccountMargin } from "./data";
import { createDefaultDraft, type OrderFormDraft } from "./islandLogic";
import { orderFormManifest } from "./manifest";
import { orderFormCss } from "./styles";

export type OrderFormRenderRequest = {
  ctx?: {
    locale?: string;
    tenant?: string;
    traceId?: string;
  };
  props?: {
    symbol?: string;
  };
};

export type OrderFormRenderOptions = {
  /** Active request trace; a render span is recorded when provided. */
  trace?: RequestTrace;
  /**
   * Shared per-request cache map so `account` coalesces with account-bar /
   * positions-table. Defaults to a process-wide map (mirrors a server cache).
   */
  cache?: Map<string, DataCacheEntry>;
};

/** Island snapshot handed to `mountIsland` (C2 `{ props, slice }` shape). */
export type OrderFormIslandProps = {
  symbol: string;
  draft: OrderFormDraft;
  account: AccountMargin;
};

const sharedCache = new Map<string, DataCacheEntry>();

function toRequestContext(ctx: OrderFormRenderRequest["ctx"]): RequestContext {
  return createRequestContext({
    headers: {
      "x-locale": ctx?.locale ?? "en-US",
      "x-tenant": ctx?.tenant ?? "default",
      ...(ctx?.traceId ? { "x-trace-id": ctx.traceId } : {}),
    },
  });
}

export async function renderOrderForm(
  request: OrderFormRenderRequest,
  options: OrderFormRenderOptions = {},
) {
  const { trace } = options;
  const renderSpan = trace?.startSpan("render:order-form", "fragment", {
    attributes: { fragment: orderFormManifest.name },
  });

  if (!request.props) {
    trace?.endSpan(renderSpan ?? "", {
      status: "fallback",
      attributes: { reason: "missing props", propsValid: false },
    });
    return {
      statusCode: 400,
      body: createOrderFormFallback("missing props"),
    };
  }

  try {
    const ctx = toRequestContext(request.ctx);
    const symbol = (request.props.symbol ?? "BTC").toUpperCase();
    const cache = options.cache ?? sharedCache;

    // Request-time account/margin read (contract C4 -> C5 sourceIds.account).
    const account = await loadAccountMargin(ctx, cache);

    const draft = createDefaultDraft();
    const islandProps: OrderFormIslandProps = { symbol, draft, account };

    const html = renderOrderFormHtml(symbol, draft, account, islandProps);

    trace?.endSpan(renderSpan ?? "", {
      status: "ok",
      attributes: { symbol, propsValid: true, hasIsland: true },
    });

    return {
      statusCode: 200,
      body: {
        html,
        assets: orderFormManifest.assets,
        // Realtime + request-time margin: never cache across requests.
        cache: { ttl: 0, tags: ["order-form", `account`] },
        metadata: {
          name: orderFormManifest.name,
          version: orderFormManifest.version,
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
      body: createOrderFormFallback(
        error instanceof Error ? error.message : "render failed",
      ),
    };
  }
}

/**
 * Server-safe first paint: the full form structure (market/limit tabs, size
 * input, leverage track, buy/sell buttons, reduce-only, margin preview) as an
 * HTML string — no React — plus the frozen C2 island mount node with an inline
 * `{ props, slice }` snapshot the page hydrates via `@mvp/islands`
 * `mountIsland`. Readable with JS disabled (degraded, non-interactive).
 */
export function renderOrderFormHtml(
  symbol: string,
  draft: OrderFormDraft,
  account: AccountMargin,
  islandProps: OrderFormIslandProps,
): string {
  const snapshot = buildIslandSnapshot(islandProps);
  const activeBuy = draft.side === "buy";
  return (
    `<style data-fragment-style="order-form">${orderFormCss}</style>` +
    `<section data-fragment="order-form" data-symbol="${escapeHtml(symbol)}">` +
    `<div data-island="orderForm">` +
    // --- SSR first paint (readable, static) ---
    `<form class="of-form" data-of-form>` +
    `<div class="of-side" role="tablist" aria-label="Order side">` +
    `<button type="button" role="tab" class="of-side-buy" aria-selected="${activeBuy}" data-side="buy">Buy</button>` +
    `<button type="button" role="tab" class="of-side-sell" aria-selected="${!activeBuy}" data-side="sell">Sell</button>` +
    `</div>` +
    `<div class="of-type" role="tablist" aria-label="Order type">` +
    `<button type="button" role="tab" class="of-type-market" aria-selected="${draft.type === "market"}" data-type="market">Market</button>` +
    `<button type="button" role="tab" class="of-type-limit" aria-selected="${draft.type === "limit"}" data-type="limit">Limit</button>` +
    `</div>` +
    `<label class="of-field of-price" data-of-price hidden>` +
    `<span>Price</span>` +
    `<input type="number" name="price" step="any" inputmode="decimal" value="${draft.price ?? ""}" />` +
    `</label>` +
    `<label class="of-field of-size">` +
    `<span>Size</span>` +
    `<input type="number" name="size" step="any" inputmode="decimal" value="${draft.size ?? ""}" />` +
    `</label>` +
    `<div class="of-field of-leverage">` +
    `<span>Leverage <strong data-of-leverage-value>${draft.leverage}x</strong></span>` +
    `<div class="of-leverage-track" data-of-leverage role="slider" aria-valuemin="1" aria-valuemax="100" aria-valuenow="${draft.leverage}"></div>` +
    `</div>` +
    `<label class="of-field of-reduce-only">` +
    `<input type="checkbox" name="reduceOnly"${draft.reduceOnly ? " checked" : ""} />` +
    `<span>Reduce only</span>` +
    `</label>` +
    `<dl class="of-margin" data-of-margin>` +
    `<div><dt>Equity</dt><dd data-of-equity>${formatUsd(account.equity)}</dd></div>` +
    `<div><dt>Used margin</dt><dd data-of-used>${formatUsd(account.used)}</dd></div>` +
    `<div><dt>Available</dt><dd data-of-free>${formatUsd(account.free)}</dd></div>` +
    `</dl>` +
    `<button type="submit" class="of-submit of-submit-${escapeHtml(draft.side)}" data-of-submit>${activeBuy ? "Buy" : "Sell"} ${escapeHtml(symbol)}</button>` +
    `</form>` +
    // --- C2 inline snapshot ---
    `<script type="application/json" data-island-props="orderForm">${snapshot}</script>` +
    `</div>` +
    `</section>`
  );
}

/**
 * Builds the frozen C2 `{ props, slice, fragment, version }` snapshot JSON.
 * `slice` is the store slice the island reads/writes — the full order-draft
 * channel id, so the store maps it directly (the island folds book price +
 * leverage into it and re-emits `trade.order-draft`). `fragment`/`version`
 * stamp this fragment's own manifest identity (§4.3.1 version handshake) so
 * `@mvp/islands` can detect drift against what the page-bundled island
 * expects.
 */
export function buildIslandSnapshot(props: OrderFormIslandProps): string {
  const snapshot = {
    props,
    slice: TRADE_ORDER_DRAFT,
    fragment: orderFormManifest.name,
    version: orderFormManifest.version,
  };
  // Escape `<` so the JSON can never terminate the surrounding <script> early.
  return JSON.stringify(snapshot).replaceAll("<", "\\u003c");
}

export function createOrderFormFallback(reason: string) {
  return {
    html: `<section data-fragment="order-form" data-fallback="true">Order form unavailable: ${escapeHtml(reason)}</section>`,
    assets: { js: [], css: [] },
    cache: { ttl: 10, tags: ["order-form", "fallback"] },
    metadata: {
      name: orderFormManifest.name,
      version: orderFormManifest.version,
      // Contract flag: marks this response as a degraded fallback.
      fallback: true,
    },
  };
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
