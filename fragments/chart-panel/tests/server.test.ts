import {
  configureTraceExport,
  type RequestTraceSnapshot,
  resetTraceExport,
} from "@mvp/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chartPanelBudget } from "../src/budget";
import { validateChartPanelManifest } from "../src/manifest";
import { renderChartPanel } from "../src/render";
import { buildServer } from "../src/server";

afterEach(() => {
  resetTraceExport();
  vi.restoreAllMocks();
});

describe("chart-panel fragment service", () => {
  it("/ returns a browser-readable service demo", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("chart-panel fragment");
    expect(response.body).toContain("POST http://localhost:4211/render");
    // Sample render is embedded and readable with no JS.
    expect(response.body).toContain('data-fragment="chart-panel"');
  });

  it("/health returns ok with service and uptime", async () => {
    let clock = 1000;
    const server = buildServer({ now: () => clock });
    clock = 1500;
    const response = await server.inject({ method: "GET", url: "/health" });
    const body = response.json();
    expect(body).toMatchObject({ status: "ok", service: "chart-panel" });
    expect(body.uptimeMs).toBe(500);
  });

  it("/manifest passes schema validation + declares isr candle deps", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/manifest" });
    const manifest = response.json();
    expect(validateChartPanelManifest(manifest)).toBe(true);
    expect(manifest.renderStrategy).toBe("isr");
    expect(manifest.cachePolicy.ttl).toBe(60);
    expect(manifest.assets.js).toContain("@mvp/trade-client");
    expect(manifest.assets.js).toContain("@mvp/ui/shadcn");
    expect(manifest.dataDependencies).toEqual(
      expect.arrayContaining(["candles.history.BTC.1m", "candles.BTC.1m"]),
    );
  });

  it("/assets returns js and css arrays with the shared chunks", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/assets" });
    expect(response.json()).toMatchObject({
      js: expect.arrayContaining(["@mvp/trade-client", "@mvp/ui/shadcn"]),
      css: expect.any(Array),
    });
  });

  it("/render emits a stable chart from the frozen candle fixture", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: {
        ctx: { locale: "en-US" },
        props: { symbol: "BTC", interval: "1m" },
      },
    });
    expect(response.statusCode).toBe(200);
    const html = response.json().html as string;
    // OHLC summary comes only from the data plane (proves @mvp/data ran).
    expect(html).toContain('data-value="close">63,072.29');
    expect(html).toContain('data-field="pair">BTC');
    expect(html).toContain(">60 candles loaded<");
  });

  it("/render emits the C2 island mount markup + inline JSON snapshot", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: { symbol: "BTC", interval: "1m" } },
    });
    const html = response.json().html as string;
    expect(html).toContain('data-island="chart"');
    expect(html).toContain('data-island-props="chart"');
    const match = html.match(
      /<script type="application\/json" data-island-props="chart">([\s\S]*?)<\/script>/,
    );
    expect(match).toBeTruthy();
    const snapshot = JSON.parse((match?.[1] ?? "").replaceAll("\\u003c", "<"));
    expect(snapshot.slice).toBe("trade.chart-interval");
    expect(snapshot.props.symbol).toBe("BTC");
    expect(snapshot.props.interval).toBe("1m");
    expect(snapshot.props.series).toHaveLength(60);
  });

  it("/render returns a safe fallback for missing props", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { ctx: {} },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().html).toContain("data-fallback");
  });

  it("renderChartPanel tolerates an unknown symbol via the fixture fallback", async () => {
    const result = await renderChartPanel({ props: { symbol: "DOGE" } });
    expect(result.statusCode).toBe(200);
    expect("html" in result.body && result.body.html).toContain(
      'data-fragment="chart-panel"',
    );
  });

  it("/metrics exposes Prometheus text after traffic", async () => {
    const server = buildServer();
    await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: { symbol: "BTC", interval: "1m" } },
    });
    const response = await server.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    const body = response.body;
    expect(body).toContain("# TYPE http_requests_total counter");
    expect(body).toContain('route="/render"');
    expect(body).toContain("# TYPE fragment_render_duration_seconds histogram");
    expect(body).toContain("fragment_render_duration_seconds_bucket");
  });

  it("/metrics and /health do not pollute HTTP request metrics", async () => {
    const server = buildServer();
    await server.inject({ method: "GET", url: "/health" });
    const response = await server.inject({ method: "GET", url: "/metrics" });
    expect(response.body).not.toContain('route="/health"');
    expect(response.body).not.toContain('route="/metrics"');
  });

  it("/render exports a trace with a render span through the pipeline", async () => {
    const exported: RequestTraceSnapshot[] = [];
    const server = buildServer();
    configureTraceExport({
      exporters: [{ export: (snapshot) => void exported.push(snapshot) }],
    });
    await server.inject({
      method: "POST",
      url: "/render",
      payload: {
        ctx: { traceId: "trace-chart-panel-test" },
        props: { symbol: "BTC", interval: "1m" },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(exported).toHaveLength(1);
    expect(exported[0].traceId).toBe("trace-chart-panel-test");
    const names = exported[0].nodes.map((node) => node.name);
    expect(names).toContain("request:/render");
    expect(names).toContain("render:chart-panel");
  });

  it("declares a fragment budget within the 30KB JS / 10KB CSS ceiling", () => {
    expect(chartPanelBudget).toMatchObject({
      scope: "fragment",
      maxFragmentLatencyMs: 200,
    });
    expect(chartPanelBudget.jsBytes).toBeLessThanOrEqual(30_000);
    expect(chartPanelBudget.cssBytes).toBeLessThanOrEqual(10_000);
  });
});
