import { describe, expect, it } from "vitest";
import { buildEquityCurve, type CurveCandle } from "../src/curve";
import type { PnlSnapshot } from "../src/data";
import {
  createPnlChartFallback,
  renderPnlChart,
  renderPnlChartHtml,
} from "../src/render";

function candles(closes: number[]): CurveCandle[] {
  return closes.map((close, i) => ({ openTime: 1_000 + i * 60_000, close }));
}

function snapshot(
  closes: number[],
  overrides: Partial<PnlSnapshot> = {},
): PnlSnapshot {
  return {
    symbol: "BTC",
    interval: "1m",
    baseline: 100_000,
    series: buildEquityCurve(candles(closes), { baseline: 100_000, size: 1 }),
    ...overrides,
  };
}

describe("renderPnlChartHtml (pure, deterministic given snapshot)", () => {
  it("renders a stable pnl chart with an SVG polyline and labels", () => {
    const html = renderPnlChartHtml(snapshot([100, 130, 160]), "24h");
    expect(html).toContain('data-fragment="pnl-chart"');
    expect(html).toContain('data-symbol="BTC"');
    // hand-rolled SVG polyline, not a chart library
    expect(html).toContain("<svg");
    expect(html).toContain("<polyline");
    expect(html).toContain('points="');
    // latest cumulative PnL label (+$60.00) and period return
    expect(html).toContain("+$60.00");
    expect(html).toContain("+0.06%");
    // range label surfaced
    expect(html).toContain(">24h<");
  });

  it("marks an up (profit) curve with the up direction hook", () => {
    const html = renderPnlChartHtml(snapshot([100, 200]), "24h");
    expect(html).toContain('data-direction="up"');
    expect(html).toContain("pnl-chart__stats--up");
  });

  it("marks a down (loss) curve with the down direction hook", () => {
    const html = renderPnlChartHtml(snapshot([100, 50]), "24h");
    expect(html).toContain('data-direction="down"');
    expect(html).toContain("pnl-chart__stats--down");
    expect(html).toContain("-$50.00");
    expect(html).toContain("-0.05%");
  });

  it("marks a flat curve with the flat direction hook", () => {
    const html = renderPnlChartHtml(snapshot([100, 100]), "24h");
    expect(html).toContain('data-direction="flat"');
    expect(html).toContain("pnl-chart__stats--flat");
    expect(html).toContain("$0.00");
  });

  it("renders a no-JS-readable textual summary (SSR-visible)", () => {
    const html = renderPnlChartHtml(snapshot([100, 130, 160]), "24h");
    expect(html).toContain('class="pnl-chart__sr"');
    expect(html).toContain("BTC PnL over 24h");
    expect(html).toContain("3 samples");
  });

  it("draws a dashed zero-PnL baseline and grid lines", () => {
    const html = renderPnlChartHtml(snapshot([100, 130]), "24h");
    expect(html).toContain('class="pnl-chart__baseline"');
    expect(html).toContain('stroke-dasharray="3 3"');
    expect(html).toContain('class="pnl-chart__grid"');
  });

  it("emits a valid, readable SVG even for an empty series (edge)", () => {
    const html = renderPnlChartHtml(snapshot([]), "24h");
    expect(html).toContain("<svg");
    // no polyline when there are no samples, but the baseline/grid still render
    expect(html).not.toContain("<polyline");
    expect(html).toContain('class="pnl-chart__baseline"');
    expect(html).toContain("0 samples");
    expect(html).toContain("$0.00");
  });

  it("renders a valid SVG for a single-point series (edge)", () => {
    const html = renderPnlChartHtml(snapshot([64_000]), "24h");
    expect(html).toContain("<polyline");
    expect(html).toContain("1 samples");
  });

  it("is stable across identical inputs (no non-determinism)", () => {
    const snap = snapshot([100, 130, 90, 160]);
    expect(renderPnlChartHtml(snap, "24h")).toBe(
      renderPnlChartHtml(snap, "24h"),
    );
  });
});

describe("createPnlChartFallback", () => {
  it("returns a no-JS-readable degraded section", () => {
    const fb = createPnlChartFallback("boom");
    expect(fb.html).toContain('data-fallback="true"');
    expect(fb.html).toContain("boom");
    expect(fb.assets).toEqual({ js: [], css: [] });
  });
});

describe("renderPnlChart (SSR entry, reads through C4 client)", () => {
  it("defaults the symbol when missing (account-level portfolio chart)", async () => {
    // The PnL chart is account-level; a missing symbol defaults instead of
    // failing, so the portfolio page (which has no active symbol) still gets a
    // rendered curve rather than a 400 fallback.
    const result = await renderPnlChart({ props: {} });
    expect(result.statusCode).toBe(200);
    if (!("html" in result.body)) throw new Error("expected html body");
    expect(result.body.html).toContain("<svg");
    expect(result.body.html).not.toContain('data-fallback="true"');
  });

  it("renders a curve synthesized from candle history via createTradeDataClient", async () => {
    const result = await renderPnlChart({
      ctx: { locale: "en-US" },
      props: { symbol: "BTC", interval: "1m", range: "24h" },
    });
    expect(result.statusCode).toBe(200);
    if (!("html" in result.body)) throw new Error("expected html body");
    const { html } = result.body;
    expect(html).toContain('data-fragment="pnl-chart"');
    expect(html).toContain('data-symbol="BTC"');
    expect(html).toContain("<polyline");
    // a signed USD PnL label is present
    expect(html).toMatch(/[+-]?\$[\d,]+\.\d{2}/);
  });

  it("attaches the ISR pnl cache policy (60s)", async () => {
    const result = await renderPnlChart({
      props: { symbol: "ETH" },
    });
    if (!("cache" in result.body)) throw new Error("expected cache body");
    expect(result.body.cache.ttl).toBe(60);
    expect(result.body.cache.tags).toContain("pnl");
    expect(result.body.cache.tags).toContain("pnl:ETH");
  });

  it("is deterministic: same props render byte-identical html", async () => {
    const a = await renderPnlChart({ props: { symbol: "BTC" } });
    const b = await renderPnlChart({ props: { symbol: "BTC" } });
    if (!("html" in a.body) || !("html" in b.body))
      throw new Error("expected html bodies");
    expect(a.body.html).toBe(b.body.html);
  });
});
