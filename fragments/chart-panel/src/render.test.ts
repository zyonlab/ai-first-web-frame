import { TRADE_CHART_INTERVAL } from "@mvp/trade-contracts";
import { describe, expect, it } from "vitest";
import { chartPanelBudget } from "./budget";
import { validateChartPanelManifest } from "./manifest";
import {
  type ChartPanelIslandProps,
  createChartPanelFallback,
  renderChartPanel,
} from "./render";

const okRender = (props: { symbol?: string; interval?: string } = {}) =>
  renderChartPanel({
    ctx: { locale: "en-US" },
    props: { symbol: "btc", ...props },
  });

function extractSnapshot(html: string): {
  props: ChartPanelIslandProps;
  slice: string;
} {
  const match = html.match(
    /<script type="application\/json" data-island-props="chart">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("no island snapshot found");
  const json = (match[1] ?? "").replaceAll("\\u003c", "<");
  return JSON.parse(json);
}

describe("chart-panel render — first paint", () => {
  it("renders a canvas placeholder, interval control, and OHLC summary", async () => {
    const result = await okRender();
    expect(result.statusCode).toBe(200);
    const html = "html" in result.body ? result.body.html : "";
    expect(html).toContain('data-fragment="chart-panel"');
    // symbol is uppercased
    expect(html).toContain('data-field="pair">BTC');
    // canvas placeholder
    expect(html).toContain('class="chart-panel__canvas"');
    expect(html).toContain('data-field="canvas"');
    // interval chips for every CHART_INTERVAL, default 1m active
    expect(html).toContain('data-interval="1m"');
    expect(html).toContain('data-interval="5m"');
    expect(html).toContain('data-interval="15m"');
    expect(html).toContain('data-interval="1h"');
    expect(html).toContain('data-interval="4h"');
    expect(html).toContain('data-interval="1d"');
    expect(html).toContain(
      'data-interval="1m" aria-selected="true" data-active="true"',
    );
  });

  it("renders the latest-candle O/H/L/C summary from the seeded fixture (C4/C5)", async () => {
    const result = await okRender();
    const html = "html" in result.body ? result.body.html : "";
    // BTC 1m fixture last candle: O 63,037.67 H 63,082.82 L 63,027.14 C 63,072.29.
    expect(html).toContain('data-value="open">63,037.67');
    expect(html).toContain('data-value="high">63,082.82');
    expect(html).toContain('data-value="low">63,027.14');
    expect(html).toContain('data-value="close">63,072.29');
    // close > open -> up direction color hook.
    expect(html).toContain('data-direction="up"');
    expect(html).toContain("chart-panel__close--up");
  });

  it("reports the bootstrap candle count (60 candles from the fixture)", async () => {
    const result = await okRender();
    const html = "html" in result.body ? result.body.html : "";
    expect(html).toContain(">60 candles loaded<");
  });

  it("emits the C2 island mount node with an inline {props,slice} snapshot", async () => {
    const result = await okRender();
    const html = "html" in result.body ? result.body.html : "";
    expect(html).toContain('<div data-island="chart"');
    expect(html).toContain(
      '<script type="application/json" data-island-props="chart">',
    );
    const snapshot = extractSnapshot(html);
    // slice is the C3 chart-interval channel.
    expect(snapshot.slice).toBe(TRADE_CHART_INTERVAL);
    expect(snapshot.props.symbol).toBe("BTC");
    expect(snapshot.props.interval).toBe("1m");
    // The initial series carries the full candle history for flash-free paint.
    expect(Array.isArray(snapshot.props.series)).toBe(true);
    expect(snapshot.props.series).toHaveLength(60);
    const last = snapshot.props.series[snapshot.props.series.length - 1];
    expect(last).toMatchObject({
      open: 63037.67,
      high: 63082.82,
      low: 63027.14,
      close: 63072.29,
    });
    // Chart candle shape: time (not openTime), no volume.
    expect(last.time).toBe(3540000);
    expect("volume" in last).toBe(false);
  });

  it("escapes < in the snapshot so it can never break out of the script tag", async () => {
    const result = await okRender();
    const html = "html" in result.body ? result.body.html : "";
    const raw = html.match(
      /data-island-props="chart">([\s\S]*?)<\/script>/,
    )?.[1];
    expect(raw).toBeTruthy();
    expect(raw).not.toContain("<");
  });

  it("honors a requested interval and rejects an unknown one (falls back to 1m)", async () => {
    const okInterval = await okRender({ interval: "5m" });
    const okHtml = "html" in okInterval.body ? okInterval.body.html : "";
    expect(extractSnapshot(okHtml).props.interval).toBe("5m");
    expect(okHtml).toContain('data-interval="5m" aria-selected="true"');

    const bad = await okRender({ interval: "3s" });
    const badHtml = "html" in bad.body ? bad.body.html : "";
    expect(extractSnapshot(badHtml).props.interval).toBe("1m");
  });

  it("uses ISR semantics: 60s history TTL + candles tag scoped to symbol/interval", async () => {
    const result = await okRender();
    if (!("cache" in result.body)) throw new Error("expected render body");
    expect(result.body.cache.ttl).toBe(60);
    expect(result.body.cache.tags).toContain("candles:BTC:1m");
  });

  it("returns a data-fallback for missing props (400)", async () => {
    const result = await renderChartPanel({ ctx: {} });
    expect(result.statusCode).toBe(400);
    expect("html" in result.body && result.body.html).toContain(
      'data-fallback="true"',
    );
  });

  it("createChartPanelFallback keeps the island marker so the chart can still mount", () => {
    const fallback = createChartPanelFallback("boom");
    // Degraded, but the island shell survives (marker + canvas + snapshot) so it
    // hydrates and populates live rather than losing the whole chart region.
    expect(fallback.html).toContain('data-fallback="true"');
    expect(fallback.html).toContain('data-island="chart"');
    expect(fallback.html).toContain('data-island-props="chart"');
    expect(fallback.html).toContain('data-degraded-reason="boom"');
    // Island/canvas assets are retained so the degraded shell can hydrate.
    expect(fallback.assets.js.length).toBeGreaterThan(0);
    expect(fallback.cache.ttl).toBe(10);
  });

  it("passes manifest schema validation", () => {
    expect(validateChartPanelManifest()).toBe(true);
  });
});

describe("chart-panel budget (hard gate, React + canvas on shared chunk)", () => {
  it("declares the fragment budget within the 30KB JS / 10KB CSS gate", () => {
    expect(chartPanelBudget).toMatchObject({
      scope: "fragment",
      name: "chart-panel",
      maxFragmentLatencyMs: 200,
    });
    expect(chartPanelBudget.jsBytes).toBeLessThanOrEqual(30000);
    expect(chartPanelBudget.cssBytes).toBeLessThanOrEqual(10000);
  });

  it("self-audit: fragment JS ships only island glue; React/canvas/Tabs are shared", async () => {
    const { chartPanelManifest } = await import("./manifest");
    // The canvas renderer + React ride @mvp/trade-client; the interval Tabs ride
    // @mvp/ui/shadcn. The fragment owns only the island glue.
    expect(chartPanelManifest.assets.js).toContain("@mvp/trade-client");
    expect(chartPanelManifest.assets.js).toContain("@mvp/ui/shadcn");
    const ownGlue = chartPanelManifest.assets.js.filter((a) =>
      a.startsWith("/assets/"),
    );
    expect(ownGlue).toEqual(["/assets/chart-panel.island.js"]);
    // No external chart library declared anywhere in the assets.
    const joined = chartPanelManifest.assets.js.join(" ");
    expect(joined).not.toMatch(/uplot|lightweight-charts|chart\.js|d3/i);
  });
});
