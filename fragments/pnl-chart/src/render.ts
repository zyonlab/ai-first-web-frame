import type { RequestContext } from "@mvp/contracts";
import type { RequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import {
  DEFAULT_VIEWBOX,
  formatPnl,
  formatReturnPct,
  latestPnl,
  type PnlPoint,
  periodReturnPct,
  pnlDirection,
  toPolyline,
} from "./curve";
import { loadPnlSnapshot, type PnlSnapshot } from "./data";
import { pnlChartManifest } from "./manifest";

export type PnlChartRenderRequest = {
  ctx?: {
    locale?: string;
    tenant?: string;
    traceId?: string;
  };
  props?: {
    symbol?: string;
    /** Candle interval whose history seeds the curve (defaults to `1m`). */
    interval?: string;
    /** Logical range label shown in the header (e.g. `24h`). Cosmetic only. */
    range?: string;
  };
};

export type PnlChartRenderOptions = {
  /** Active request trace; a render span is recorded when provided. */
  trace?: RequestTrace;
};

function toRequestContext(ctx: PnlChartRenderRequest["ctx"]): RequestContext {
  return createRequestContext({
    headers: {
      "x-locale": ctx?.locale ?? "en-US",
      "x-tenant": ctx?.tenant ?? "default",
      ...(ctx?.traceId ? { "x-trace-id": ctx.traceId } : {}),
    },
  });
}

export async function renderPnlChart(
  request: PnlChartRenderRequest,
  options: PnlChartRenderOptions = {},
) {
  const { trace } = options;
  const renderSpan = trace?.startSpan("render:pnl-chart", "fragment", {
    attributes: { fragment: pnlChartManifest.name },
  });

  if (!request.props?.symbol) {
    trace?.endSpan(renderSpan ?? "", {
      status: "fallback",
      attributes: { reason: "missing symbol", propsValid: false },
    });
    return {
      statusCode: 400,
      body: createPnlChartFallback("missing symbol"),
    };
  }

  try {
    const ctx = toRequestContext(request.ctx);
    const symbol = request.props.symbol;
    const interval = request.props.interval ?? "1m";
    const range = request.props.range ?? interval;

    const snapshot = await loadPnlSnapshot(ctx, symbol, interval, trace);

    trace?.endSpan(renderSpan ?? "", {
      status: "ok",
      attributes: {
        symbol: snapshot.symbol,
        interval: snapshot.interval,
        samples: snapshot.series.length,
        pnl: latestPnl(snapshot.series),
        propsValid: true,
      },
    });

    return {
      statusCode: 200,
      body: {
        html: renderPnlChartHtml(snapshot, range),
        assets: pnlChartManifest.assets,
        cache: {
          ttl: pnlChartManifest.cachePolicy.ttl,
          tags: ["pnl", `pnl:${snapshot.symbol}`],
        },
        metadata: {
          name: pnlChartManifest.name,
          version: pnlChartManifest.version,
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
      body: createPnlChartFallback(
        error instanceof Error ? error.message : "render failed",
      ),
    };
  }
}

/**
 * Builds the server-safe pnl-chart HTML. Pure string output (no React):
 *
 * - an inline `<svg>` with a semantic-colored `<polyline>` (up = profit /
 *   down = loss) plus a tinted area fill and a dashed zero-PnL baseline,
 * - minimal grid lines + the latest cumulative PnL and period-return labels,
 * - all geometry from the pure `toPolyline` projector, so identical inputs give
 *   byte-identical SVG. The SVG itself is the no-JS-readable snapshot.
 */
export function renderPnlChartHtml(
  snapshot: PnlSnapshot,
  range: string,
): string {
  const { series, symbol } = snapshot;
  const direction = pnlDirection(series);
  const pnl = latestPnl(series);
  const pnlLabel = formatPnl(pnl);
  const returnPct = periodReturnPct(series, snapshot.baseline);
  const returnLabel = formatReturnPct(returnPct);

  const geometry = toPolyline(series, DEFAULT_VIEWBOX);
  const { width, height } = geometry.viewBox;

  return (
    `<section data-fragment="pnl-chart" data-symbol="${escapeHtml(symbol)}" data-direction="${direction}">` +
    `<header class="pnl-chart__header">` +
    `<div class="pnl-chart__meta">` +
    `<span class="pnl-chart__label">PnL</span>` +
    `<span class="pnl-chart__range">${escapeHtml(range)}</span>` +
    `</div>` +
    `<div class="pnl-chart__stats pnl-chart__stats--${direction}">` +
    `<span class="pnl-chart__pnl" data-pnl="${pnl}">${escapeHtml(pnlLabel)}</span>` +
    `<span class="pnl-chart__return" data-return="${returnPct}">${escapeHtml(returnLabel)}</span>` +
    `</div>` +
    `</header>` +
    renderSvg(geometry, direction, width, height, series.length) +
    `<p class="pnl-chart__sr" data-samples="${series.length}">` +
    `${escapeHtml(symbol)} PnL over ${escapeHtml(range)}: ${escapeHtml(pnlLabel)} (${escapeHtml(returnLabel)}), ${series.length} samples.` +
    `</p>` +
    `</section>`
  );
}

function renderSvg(
  geometry: ReturnType<typeof toPolyline>,
  direction: "up" | "down" | "flat",
  width: number,
  height: number,
  sampleCount: number,
): string {
  const gridY1 = round1(height * 0.25);
  const gridY2 = round1(height * 0.75);

  // Empty series: still emit a readable, valid SVG with just the grid + baseline
  // so the no-JS snapshot never collapses to nothing.
  const polyline =
    sampleCount === 0
      ? ""
      : `<path class="pnl-chart__area" d="${escapeAttr(geometry.areaPath)}" />` +
        `<polyline class="pnl-chart__line" points="${escapeAttr(geometry.pointsAttr)}" ` +
        `fill="none" vector-effect="non-scaling-stroke" />`;

  return (
    `<svg class="pnl-chart__svg" viewBox="0 0 ${width} ${height}" ` +
    `role="img" aria-label="PnL curve" preserveAspectRatio="none" ` +
    `xmlns="http://www.w3.org/2000/svg" data-direction="${direction}">` +
    `<line class="pnl-chart__grid" x1="0" y1="${gridY1}" x2="${width}" y2="${gridY1}" />` +
    `<line class="pnl-chart__grid" x1="0" y1="${gridY2}" x2="${width}" y2="${gridY2}" />` +
    `<line class="pnl-chart__baseline" x1="0" y1="${geometry.baselineY}" x2="${width}" y2="${geometry.baselineY}" ` +
    `stroke-dasharray="3 3" />` +
    polyline +
    `</svg>`
  );
}

export function createPnlChartFallback(reason: string) {
  return {
    html: `<section data-fragment="pnl-chart" data-fallback="true">PnL chart unavailable: ${escapeHtml(reason)}</section>`,
    assets: { js: [], css: [] },
    cache: { ttl: 30, tags: ["pnl", "fallback"] },
    metadata: {
      name: pnlChartManifest.name,
      version: pnlChartManifest.version,
    },
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Attribute-context escape (points/paths are numeric, but stay safe). */
function escapeAttr(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

export type { PnlPoint };
