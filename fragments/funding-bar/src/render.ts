import type { RequestContext } from "@mvp/contracts";
import type { RequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import {
  formatCountdown,
  formatFundingRate,
  fundingCountdownMs,
  fundingRateDirection,
} from "./countdown";
import { type FundingSnapshot, loadFundingSnapshot } from "./data";
import { fundingBarManifest } from "./manifest";
import { fundingBarCss } from "./styles";

export type FundingBarRenderRequest = {
  ctx?: {
    locale?: string;
    tenant?: string;
    traceId?: string;
  };
  props?: {
    symbol?: string;
    /** Injectable clock (ms) so the SSR countdown seed is deterministic in tests. */
    now?: number;
  };
};

export type FundingBarRenderOptions = {
  /** Active request trace; a render span is recorded when provided. */
  trace?: RequestTrace;
};

function toRequestContext(ctx: FundingBarRenderRequest["ctx"]): RequestContext {
  return createRequestContext({
    headers: {
      "x-locale": ctx?.locale ?? "en-US",
      "x-tenant": ctx?.tenant ?? "default",
      ...(ctx?.traceId ? { "x-trace-id": ctx.traceId } : {}),
    },
  });
}

export async function renderFundingBar(
  request: FundingBarRenderRequest,
  options: FundingBarRenderOptions = {},
) {
  const { trace } = options;
  const renderSpan = trace?.startSpan("render:funding-bar", "fragment", {
    attributes: { fragment: fundingBarManifest.name },
  });

  if (!request.props?.symbol) {
    trace?.endSpan(renderSpan ?? "", {
      status: "fallback",
      attributes: { reason: "missing symbol", propsValid: false },
    });
    return {
      statusCode: 400,
      body: createFundingBarFallback("missing symbol"),
    };
  }

  try {
    const ctx = toRequestContext(request.ctx);
    const symbol = request.props.symbol;
    const now = request.props.now ?? Date.now();

    const snapshot = await loadFundingSnapshot(ctx, symbol, trace);

    trace?.endSpan(renderSpan ?? "", {
      status: "ok",
      attributes: {
        symbol: snapshot.symbol,
        rate: snapshot.rate,
        propsValid: true,
      },
    });

    return {
      statusCode: 200,
      body: {
        html: renderFundingBarHtml(snapshot, now),
        assets: fundingBarManifest.assets,
        cache: {
          ttl: fundingBarManifest.cachePolicy.ttl,
          tags: ["funding", `funding:${snapshot.symbol}`],
        },
        metadata: {
          name: fundingBarManifest.name,
          version: fundingBarManifest.version,
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
      body: createFundingBarFallback(
        error instanceof Error ? error.message : "render failed",
      ),
    };
  }
}

/**
 * Builds the server-safe funding-bar HTML. Pure string output (no React):
 * current funding rate with up/down semantic class, a `<time>` countdown seeded
 * from `now`, and the oracle price. The countdown carries
 * `data-next-funding-ts` so an optional vanilla tick can recompute the label.
 */
export function renderFundingBarHtml(
  snapshot: FundingSnapshot,
  now: number,
): string {
  const direction = fundingRateDirection(snapshot.rate);
  const rateLabel = formatFundingRate(snapshot.rate);
  const remainingMs = fundingCountdownMs(now, snapshot.nextFundingTs);
  const countdownLabel = formatCountdown(remainingMs);
  const nextFundingIso = new Date(snapshot.nextFundingTs).toISOString();
  const oracleLabel = formatPrice(snapshot.oraclePrice);

  return (
    `<style data-fragment-style="funding-bar">${fundingBarCss}</style>` +
    `<section data-fragment="funding-bar" data-symbol="${escapeHtml(snapshot.symbol)}">` +
    `<div class="funding-bar__item funding-bar__rate funding-bar__rate--${direction}">` +
    `<span class="funding-bar__label">Funding</span>` +
    `<span class="funding-bar__value" data-rate-direction="${direction}" data-rate="${snapshot.rate}">${escapeHtml(rateLabel)}</span>` +
    `</div>` +
    `<div class="funding-bar__item funding-bar__countdown">` +
    `<span class="funding-bar__label">Next funding</span>` +
    `<time class="funding-bar__value" datetime="${escapeHtml(nextFundingIso)}" data-next-funding-ts="${snapshot.nextFundingTs}">${escapeHtml(countdownLabel)}</time>` +
    `</div>` +
    `<div class="funding-bar__item funding-bar__oracle">` +
    `<span class="funding-bar__label">Oracle</span>` +
    `<span class="funding-bar__value" data-oracle="${snapshot.oraclePrice}">${escapeHtml(oracleLabel)}</span>` +
    `</div>` +
    `</section>`
  );
}

export function createFundingBarFallback(reason: string) {
  return {
    html: `<section data-fragment="funding-bar" data-fallback="true">Funding unavailable: ${escapeHtml(reason)}</section>`,
    assets: { js: [], css: [] },
    cache: { ttl: 10, tags: ["funding", "fallback"] },
    metadata: {
      name: fundingBarManifest.name,
      version: fundingBarManifest.version,
      // Contract flag: marks this response as a degraded fallback.
      fallback: true,
    },
  };
}

function formatPrice(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
