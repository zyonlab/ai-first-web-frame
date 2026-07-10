import type { RequestContext } from "@mvp/contracts";
import type { RequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import {
  type AccountBarView,
  loadAccountBarData,
  toAccountBarView,
} from "./data";
import { accountBarManifest } from "./manifest";
import { accountBarCss } from "./styles";

export type AccountBarRenderRequest = {
  ctx?: {
    locale?: string;
    tenant?: string;
    traceId?: string;
  };
  // account-bar takes `{}` props (account comes from ctx); an empty object is a
  // valid render. `props` being absent entirely is the "missing props" fallback.
  props?: Record<string, never>;
};

export type AccountBarRenderOptions = {
  /** Active request trace; a render span is recorded when provided. */
  trace?: RequestTrace;
};

/** The C2 island name / `data-island` value this fragment emits. */
export const ISLAND_NAME = "accountBar";
/** The store slice the island reads to follow the current leverage (C3). */
export const ISLAND_SLICE = "trade.leverage";

function toRequestContext(ctx: AccountBarRenderRequest["ctx"]): RequestContext {
  return createRequestContext({
    headers: {
      "x-locale": ctx?.locale ?? "en-US",
      "x-tenant": ctx?.tenant ?? "default",
      ...(ctx?.traceId ? { "x-trace-id": ctx.traceId } : {}),
    },
  });
}

/**
 * The island snapshot (C2). Carries the flat account view plus the leverage the
 * SSR preview was seeded at, so the island's first paint matches SSR exactly
 * with JS disabled and needs no network for first interactivity.
 */
export type AccountBarIslandProps = {
  view: AccountBarView;
  /** Leverage the SSR margin preview was seeded at (store default = 1x). */
  seededLeverage: number;
};

/** The default leverage the SSR snapshot seeds the preview at (store default). */
export const DEFAULT_LEVERAGE = 1;

/**
 * Builds the SSR HTML for the account stat row plus the C2 island mount markup.
 *
 * Layout mirrors 01-ui-layout §4 A2-account: one dense stat row (equity ·
 * margin used · withdrawable) with a small margin-usage meter. The meter cell
 * exposes a `--usage` custom property so the scoped CSS fills the bar without
 * any JS; the island re-writes it on a leverage-driven preview.
 */
export function renderAccountBarHtml(
  view: AccountBarView,
  seededLeverage: number,
): string {
  const props: AccountBarIslandProps = { view, seededLeverage };
  const snapshot = JSON.stringify({ props, slice: ISLAND_SLICE });

  return (
    `<style data-fragment-style="account-bar">${accountBarCss}</style>` +
    `<section data-fragment="account-bar" class="account-bar">` +
    `<div data-island="${ISLAND_NAME}" class="account-bar__row">` +
    `<span class="account-bar__stat" data-field="equity">` +
    `<small class="account-bar__caption">Equity</small>` +
    `<b data-value="equity">${escapeHtml(view.equity)}</b></span>` +
    `<span class="account-bar__stat" data-field="marginUsed">` +
    `<small class="account-bar__caption">Margin Used</small>` +
    `<b data-value="marginUsed">${escapeHtml(view.marginUsed)}</b></span>` +
    `<span class="account-bar__stat" data-field="withdrawable">` +
    `<small class="account-bar__caption">Withdrawable</small>` +
    `<b data-value="withdrawable">${escapeHtml(view.withdrawable)}</b></span>` +
    `<span class="account-bar__stat account-bar__meter" data-field="marginUsage" ` +
    `style="--usage:${view.marginUsageRatio.toFixed(4)}">` +
    `<small class="account-bar__caption">Margin Usage</small>` +
    `<span class="account-bar__meter-track" aria-hidden="true">` +
    `<span class="account-bar__meter-fill"></span></span>` +
    `<b data-value="marginUsagePct">${escapeHtml(view.marginUsagePct)}</b></span>` +
    `<script type="application/json" data-island-props="${ISLAND_NAME}">${escapeSnapshot(snapshot)}</script>` +
    `</div>` +
    `</section>`
  );
}

export async function renderAccountBar(
  request: AccountBarRenderRequest,
  options: AccountBarRenderOptions = {},
) {
  const { trace } = options;
  const renderSpan = trace?.startSpan("render:account-bar", "fragment", {
    attributes: { fragment: accountBarManifest.name },
  });

  if (!request.props) {
    trace?.endSpan(renderSpan ?? "", {
      status: "fallback",
      attributes: { reason: "missing props", propsValid: false },
    });
    return {
      statusCode: 400,
      body: createAccountBarFallback("missing props"),
    };
  }

  try {
    const ctx = toRequestContext(request.ctx);
    const data = await loadAccountBarData(ctx, trace);
    const view = toAccountBarView(data.account);
    const html = renderAccountBarHtml(view, DEFAULT_LEVERAGE);

    trace?.endSpan(renderSpan ?? "", {
      status: "ok",
      attributes: {
        marginUsageRatio: view.marginUsageRatio,
        propsValid: true,
      },
    });

    return {
      statusCode: 200,
      body: {
        html,
        assets: accountBarManifest.assets,
        cache: {
          ttl: accountBarManifest.cachePolicy.ttl,
          tags: [...accountBarManifest.cachePolicy.tags],
        },
        metadata: {
          name: accountBarManifest.name,
          version: accountBarManifest.version,
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
      body: createAccountBarFallback(
        error instanceof Error ? error.message : "render failed",
      ),
    };
  }
}

export function createAccountBarFallback(reason: string) {
  return {
    html: `<section data-fragment="account-bar" data-fallback="true">Account bar unavailable: ${escapeHtml(reason)}</section>`,
    assets: { js: [], css: [] },
    cache: { ttl: 0, tags: ["account-bar", "fallback"] },
    metadata: {
      name: accountBarManifest.name,
      version: accountBarManifest.version,
      // Contract flag: marks this response as a degraded fallback.
      fallback: true,
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
 * the `<` that could begin `</script>` needs neutralizing. Keeps the payload
 * valid JSON for `JSON.parse` on the client.
 */
function escapeSnapshot(json: string) {
  return json.replaceAll("<", "\\u003c");
}
