import type { RequestContext } from "@mvp/contracts";
import type { DataCacheEntry } from "@mvp/data";
import {
  CHART_INTERVALS,
  type ChartInterval,
  isChartInterval,
  TRADE_CHART_INTERVAL,
} from "@mvp/interaction";
import type { RequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import type { Candle as ChartCandle } from "@mvp/trade-client";
import { loadChartHistory } from "./data";
import {
  type ChartSummary,
  summarizeSeries,
  toChartSeries,
} from "./islandLogic";
import {
  chartPanelManifest,
  DEFAULT_INTERVAL,
  DEFAULT_SYMBOL,
} from "./manifest";

export type ChartPanelRenderRequest = {
  ctx?: {
    locale?: string;
    tenant?: string;
    traceId?: string;
  };
  props?: {
    symbol?: string;
    interval?: string;
  };
};

export type ChartPanelRenderOptions = {
  /** Active request trace; a render span is recorded when provided. */
  trace?: RequestTrace;
  /** Shared per-request cache map so history reads coalesce across the page. */
  cache?: Map<string, DataCacheEntry>;
};

/** The C2 island name / `data-island` value this fragment emits. */
export const ISLAND_NAME = "chart";
/** The store slice the island reads/writes for the interval control (C3). */
export const ISLAND_SLICE = TRADE_CHART_INTERVAL;

/** Default canvas geometry for the SSR placeholder + island first paint. */
export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 320;

/**
 * The island snapshot (C2). Carries the resolved symbol/interval plus the full
 * initial candle series so the island's canvas draws with zero flash on the
 * first paint and needs no network for first interactivity.
 */
export type ChartPanelIslandProps = {
  symbol: string;
  interval: ChartInterval;
  series: ChartCandle[];
};

function toRequestContext(ctx: ChartPanelRenderRequest["ctx"]): RequestContext {
  return createRequestContext({
    headers: {
      "x-locale": ctx?.locale ?? "en-US",
      "x-tenant": ctx?.tenant ?? "default",
      ...(ctx?.traceId ? { "x-trace-id": ctx.traceId } : {}),
    },
  });
}

/** Formats a price with thousands separators + 2 decimals (locale-stable). */
function formatPrice(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Builds the SSR HTML for the chart region plus the C2 island mount markup.
 *
 * Layout mirrors 01-ui-layout §1.1/§3: a chart container holding a `<canvas>`
 * placeholder (the island reuses it to draw candles with no flash), an interval
 * control chip group (`1m/5m/15m/1h/4h/1d`), and a static OHLC summary of the
 * latest candle. The summary's O/H/L/C close cell carries a `data-direction`
 * attribute and a `chart-panel__close--{up,down}` class so the scoped CSS colors
 * it with `--mvp-color-up` / `--mvp-color-down`. No-JS first paint stays
 * readable: the summary + placeholder describe the chart without any script.
 */
export function renderChartPanelHtml(
  symbol: string,
  interval: ChartInterval,
  series: ChartCandle[],
  degradedReason?: string,
): string {
  const props: ChartPanelIslandProps = { symbol, interval, series };
  const snapshot = JSON.stringify({ props, slice: ISLAND_SLICE });
  const summary = summarizeSeries(series);
  const intervalChips = CHART_INTERVALS.map((iv) => {
    const active = iv === interval;
    return (
      `<button type="button" role="tab" class="chart-panel__interval-chip" ` +
      `data-interval="${iv}" aria-selected="${active}"${active ? ' data-active="true"' : ""}>` +
      `${iv}</button>`
    );
  }).join("");

  // Even when the SSR history read fails we still emit the island shell (marker +
  // canvas + snapshot) so the chart mounts and populates live via subscription;
  // `data-fallback` flags the degraded SSR seed for observability.
  const sectionAttrs = degradedReason
    ? ` data-fallback="true" data-degraded-reason="${escapeHtml(degradedReason)}"`
    : "";

  return (
    `<section data-fragment="chart-panel" class="chart-panel"${sectionAttrs}>` +
    `<div data-island="${ISLAND_NAME}" class="chart-panel__island">` +
    `<header class="chart-panel__header">` +
    `<span class="chart-panel__pair" data-field="pair">${escapeHtml(symbol)}</span>` +
    `<div class="chart-panel__intervals" role="tablist" aria-label="Chart interval" data-field="intervals">` +
    intervalChips +
    `</div>` +
    `</header>` +
    renderSummary(summary) +
    `<div class="chart-panel__canvas-wrap">` +
    `<canvas class="chart-panel__canvas" data-field="canvas" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" ` +
    `role="img" aria-label="${escapeHtml(symbol)} ${escapeHtml(interval)} candlestick chart, ${series.length} candles"></canvas>` +
    `<p class="chart-panel__bootstrap" data-field="bootstrap">${series.length} candles loaded</p>` +
    `</div>` +
    `<script type="application/json" data-island-props="${ISLAND_NAME}">${escapeSnapshot(snapshot)}</script>` +
    `</div>` +
    `</section>`
  );
}

/** Renders the static latest-candle O/H/L/C summary row (no-JS readable). */
function renderSummary(summary: ChartSummary | null): string {
  if (!summary) {
    return `<div class="chart-panel__summary" data-field="summary" data-empty="true"><span class="chart-panel__stat">No candles</span></div>`;
  }
  const closeClass =
    summary.direction === "up"
      ? "chart-panel__close--up"
      : summary.direction === "down"
        ? "chart-panel__close--down"
        : "chart-panel__close--flat";
  return (
    `<div class="chart-panel__summary" data-field="summary" data-direction="${summary.direction}">` +
    `<span class="chart-panel__stat" data-field="open"><small class="chart-panel__caption">O</small>` +
    `<b data-value="open">${escapeHtml(formatPrice(summary.open))}</b></span>` +
    `<span class="chart-panel__stat" data-field="high"><small class="chart-panel__caption">H</small>` +
    `<b data-value="high">${escapeHtml(formatPrice(summary.high))}</b></span>` +
    `<span class="chart-panel__stat" data-field="low"><small class="chart-panel__caption">L</small>` +
    `<b data-value="low">${escapeHtml(formatPrice(summary.low))}</b></span>` +
    `<span class="chart-panel__stat ${closeClass}" data-field="close"><small class="chart-panel__caption">C</small>` +
    `<b data-value="close">${escapeHtml(formatPrice(summary.close))}</b></span>` +
    `</div>`
  );
}

export async function renderChartPanel(
  request: ChartPanelRenderRequest,
  options: ChartPanelRenderOptions = {},
) {
  const { trace } = options;
  const renderSpan = trace?.startSpan("render:chart-panel", "fragment", {
    attributes: { fragment: chartPanelManifest.name },
  });

  if (!request.props) {
    trace?.endSpan(renderSpan ?? "", {
      status: "fallback",
      attributes: { reason: "missing props", propsValid: false },
    });
    return {
      statusCode: 400,
      body: createChartPanelFallback("missing props"),
    };
  }

  try {
    const ctx = toRequestContext(request.ctx);
    const symbol = (request.props.symbol ?? DEFAULT_SYMBOL)
      .trim()
      .toUpperCase();
    const rawInterval = (request.props.interval ?? DEFAULT_INTERVAL)
      .trim()
      .toLowerCase();
    // Reject an unknown interval by falling back to the default (never trust
    // props blindly; the chart data key partitions by interval).
    const interval: ChartInterval = isChartInterval(rawInterval)
      ? rawInterval
      : DEFAULT_INTERVAL;

    const data = await loadChartHistory(
      ctx,
      symbol,
      interval,
      trace,
      options.cache,
    );
    const series = toChartSeries(data.history);
    const html = renderChartPanelHtml(symbol, interval, series);

    trace?.endSpan(renderSpan ?? "", {
      status: "ok",
      attributes: {
        symbol,
        interval,
        candles: series.length,
        propsValid: true,
      },
    });

    return {
      statusCode: 200,
      body: {
        html,
        assets: chartPanelManifest.assets,
        cache: {
          ttl: chartPanelManifest.cachePolicy.ttl,
          tags: [
            ...chartPanelManifest.cachePolicy.tags,
            `candles:${symbol}:${interval}`,
          ],
        },
        metadata: {
          name: chartPanelManifest.name,
          version: chartPanelManifest.version,
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
      body: createChartPanelFallback(
        error instanceof Error ? error.message : "render failed",
        request.props.symbol,
        (isChartInterval(request.props.interval ?? "")
          ? request.props.interval
          : DEFAULT_INTERVAL) as ChartInterval,
      ),
    };
  }
}

export function createChartPanelFallback(
  reason: string,
  symbol: string = DEFAULT_SYMBOL,
  interval: ChartInterval = DEFAULT_INTERVAL,
) {
  const safeSymbol = (symbol || DEFAULT_SYMBOL).trim().toUpperCase();
  const safeInterval = isChartInterval(interval) ? interval : DEFAULT_INTERVAL;
  return {
    // Degraded SSR: empty series, but the island marker + canvas survive so the
    // chart still mounts and can populate live (see renderChartPanelHtml).
    html: renderChartPanelHtml(safeSymbol, safeInterval, [], reason),
    // Keep the island/canvas assets so the degraded shell can still hydrate.
    assets: chartPanelManifest.assets,
    cache: { ttl: 10, tags: ["chart-panel", "fallback"] },
    metadata: {
      name: chartPanelManifest.name,
      version: chartPanelManifest.version,
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
