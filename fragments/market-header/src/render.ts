import type { RequestContext } from "@mvp/contracts";
import type { RequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import {
  computeCountdown,
  loadMarketHeaderData,
  type MarketHeaderView,
  toMarketHeaderView,
} from "./data";
import { DEFAULT_SYMBOL, marketHeaderManifest } from "./manifest";

export type MarketHeaderRenderRequest = {
  ctx?: {
    locale?: string;
    tenant?: string;
    traceId?: string;
  };
  props?: {
    symbol?: string;
  };
};

export type MarketHeaderRenderOptions = {
  /** Active request trace; a render span is recorded when provided. */
  trace?: RequestTrace;
  /** Injectable logical clock for a deterministic countdown seed (tests). */
  now?: () => number;
};

/** The C2 island name / `data-island` value + slice this fragment emits. */
export const ISLAND_NAME = "marketHeader";
/** The store slice the island reads to follow the active symbol (C3). */
export const ISLAND_SLICE = "trade.active-symbol";

function toRequestContext(
  ctx: MarketHeaderRenderRequest["ctx"],
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
 * The island snapshot (C2). Carries the flat view model plus the seed the
 * countdown resumes from, so the island's first paint matches SSR exactly with
 * JS disabled and needs no network for first interactivity.
 */
export type MarketHeaderIslandProps = {
  view: MarketHeaderView;
  /** Logical clock the countdown was seeded at, so the island can advance it. */
  seededNowMs: number;
  /** Countdown label rendered at SSR time. */
  countdownLabel: string;
};

/**
 * Builds the SSR HTML for the header stat row plus the C2 island mount markup.
 *
 * Layout mirrors 01-ui-layout §1.3/§4: one dense stat row (pair · mark · oracle
 * · 24h · funding · volume · countdown). The 24h change cell carries a
 * `data-direction` attribute and a `market-header__change--{up,down}` class so
 * the scoped CSS colors it with `--mvp-color-up` / `--mvp-color-down`.
 */
export function renderMarketHeaderHtml(
  view: MarketHeaderView,
  countdownLabel: string,
  seededNowMs: number,
): string {
  const props: MarketHeaderIslandProps = {
    view,
    seededNowMs,
    countdownLabel,
  };
  const snapshot = JSON.stringify({ props, slice: ISLAND_SLICE });
  const changeClass =
    view.direction === "up"
      ? "market-header__change--up"
      : view.direction === "down"
        ? "market-header__change--down"
        : "market-header__change--flat";

  return (
    `<section data-fragment="market-header" class="market-header">` +
    `<div data-island="${ISLAND_NAME}" class="market-header__row">` +
    `<span class="market-header__pair" data-field="pair">${escapeHtml(view.symbol)}</span>` +
    `<span class="market-header__stat" data-field="mark">` +
    `<small class="market-header__caption">Mark</small><b data-value="mark">${escapeHtml(view.mark)}</b></span>` +
    `<span class="market-header__stat" data-field="oracle">` +
    `<small class="market-header__caption">Oracle</small><b data-value="oracle">${escapeHtml(view.oracle)}</b></span>` +
    `<span class="market-header__stat ${changeClass}" data-field="change" data-direction="${view.direction}">` +
    `<small class="market-header__caption">24h</small><b data-value="changePct">${escapeHtml(view.changePct24h)}</b></span>` +
    `<span class="market-header__stat" data-field="funding">` +
    `<small class="market-header__caption">Funding</small><b data-value="funding">${escapeHtml(view.funding)}</b></span>` +
    `<span class="market-header__stat" data-field="volume">` +
    `<small class="market-header__caption">24h Vol</small><b data-value="volume">${escapeHtml(view.volume)}</b></span>` +
    `<span class="market-header__stat market-header__countdown" data-field="countdown">` +
    `<small class="market-header__caption">Funding in</small>` +
    `<time data-value="countdown">${escapeHtml(countdownLabel)}</time></span>` +
    `<script type="application/json" data-island-props="${ISLAND_NAME}">${escapeSnapshot(snapshot)}</script>` +
    `</div>` +
    `</section>`
  );
}

export async function renderMarketHeader(
  request: MarketHeaderRenderRequest,
  options: MarketHeaderRenderOptions = {},
) {
  const { trace } = options;
  const now = options.now ?? Date.now;
  const renderSpan = trace?.startSpan("render:market-header", "fragment", {
    attributes: { fragment: marketHeaderManifest.name },
  });

  if (!request.props) {
    trace?.endSpan(renderSpan ?? "", {
      status: "fallback",
      attributes: { reason: "missing props", propsValid: false },
    });
    return {
      statusCode: 400,
      body: createMarketHeaderFallback("missing props"),
    };
  }

  try {
    const ctx = toRequestContext(request.ctx);
    const symbol = (request.props.symbol ?? DEFAULT_SYMBOL)
      .trim()
      .toUpperCase();

    const data = await loadMarketHeaderData(ctx, symbol, trace);
    const view = toMarketHeaderView(data.ticker, data.funding);
    const seededNowMs = now();
    const { label } = computeCountdown(view.nextFundingTs, seededNowMs);
    const html = renderMarketHeaderHtml(view, label, seededNowMs);

    trace?.endSpan(renderSpan ?? "", {
      status: "ok",
      attributes: {
        symbol,
        direction: view.direction,
        propsValid: true,
      },
    });

    return {
      statusCode: 200,
      body: {
        html,
        assets: marketHeaderManifest.assets,
        cache: {
          ttl: marketHeaderManifest.cachePolicy.ttl,
          tags: [...marketHeaderManifest.cachePolicy.tags, `ticker:${symbol}`],
        },
        metadata: {
          name: marketHeaderManifest.name,
          version: marketHeaderManifest.version,
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
      body: createMarketHeaderFallback(
        error instanceof Error ? error.message : "render failed",
      ),
    };
  }
}

export function createMarketHeaderFallback(reason: string) {
  return {
    html: `<section data-fragment="market-header" data-fallback="true">Market header unavailable: ${escapeHtml(reason)}</section>`,
    assets: { js: [], css: [] },
    cache: { ttl: 5, tags: ["market-header", "fallback"] },
    metadata: {
      name: marketHeaderManifest.name,
      version: marketHeaderManifest.version,
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

/**
 * Escapes a JSON snapshot for safe embedding inside a `<script>` element: only
 * the `<` that could begin `</script>` needs neutralizing (JSON has no raw `&`
 * concerns here). Keeps the payload valid JSON for `JSON.parse` on the client.
 */
function escapeSnapshot(json: string) {
  return json.replaceAll("<", "\\u003c");
}
