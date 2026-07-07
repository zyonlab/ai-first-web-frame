import {
  configureTraceExport,
  type RequestTraceSnapshot,
  resetTraceExport,
} from "@mvp/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { marketHeaderBudget } from "../src/budget";
import { validateMarketHeaderManifest } from "../src/manifest";
import { renderMarketHeader } from "../src/render";
import { buildServer } from "../src/server";

afterEach(() => {
  resetTraceExport();
  vi.restoreAllMocks();
});

describe("market-header fragment service", () => {
  it("/ returns a browser-readable service demo", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("market-header fragment");
    expect(response.body).toContain("POST http://localhost:4203/render");
    // Sample render is embedded and readable with no JS.
    expect(response.body).toContain('data-fragment="market-header"');
  });

  it("/health returns ok with service and uptime", async () => {
    let clock = 1000;
    const server = buildServer({ now: () => clock });
    clock = 1500;
    const response = await server.inject({ method: "GET", url: "/health" });
    const body = response.json();
    expect(body).toMatchObject({ status: "ok", service: "market-header" });
    expect(body.uptimeMs).toBe(500);
  });

  it("/manifest passes schema validation", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/manifest" });
    expect(validateMarketHeaderManifest(response.json())).toBe(true);
  });

  it("/manifest declares cached-ssr near-realtime + shared trade-client chunk", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/manifest" });
    const manifest = response.json();
    expect(manifest.renderStrategy).toBe("cached-ssr");
    expect(manifest.cachePolicy.ttl).toBe(5);
    expect(manifest.assets.js).toContain("@mvp/trade-client");
    // ticker + funding data deps for the default symbol.
    expect(manifest.dataDependencies).toEqual(
      expect.arrayContaining(["ticker.BTC", "funding.BTC"]),
    );
  });

  it("/assets returns js and css arrays with the shared chunk", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/assets" });
    expect(response.json()).toMatchObject({
      js: expect.arrayContaining(["@mvp/trade-client"]),
      css: expect.any(Array),
    });
  });

  it("/render emits a stable header from the frozen ticker/funding fixture", async () => {
    // Fixed clock so the countdown seed is deterministic.
    const server = buildServer({ now: () => 0 });
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { ctx: { locale: "en-US" }, props: { symbol: "BTC" } },
    });
    expect(response.statusCode).toBe(200);
    const html = response.json().html as string;
    // Prices come only from the data plane (proves @mvp/data ran).
    expect(html).toContain('data-value="mark">63,003.35');
    expect(html).toContain('data-value="oracle">63,000.84');
    expect(html).toContain('data-value="funding">0.0000%');
    // Countdown seeded off nextFundingTs (28,800,000ms) at now=0.
    expect(html).toContain('data-value="countdown">08:00:00');
    // Pair label present.
    expect(html).toContain('data-field="pair">BTC');
  });

  it("/render colors 24h change with the up/down direction (semantic color hook)", async () => {
    const server = buildServer({ now: () => 0 });
    // ETH fixture has a positive changePct24h → `up`.
    const up = await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: { symbol: "ETH" } },
    });
    const upHtml = up.json().html as string;
    expect(upHtml).toContain('data-direction="up"');
    expect(upHtml).toContain("market-header__change--up");
  });

  it("/render emits the C2 island mount markup + inline JSON snapshot", async () => {
    const server = buildServer({ now: () => 0 });
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: { symbol: "BTC" } },
    });
    const html = response.json().html as string;
    expect(html).toContain('data-island="marketHeader"');
    expect(html).toContain('data-island-props="marketHeader"');
    // The snapshot is valid JSON carrying props + slice.
    const match = html.match(
      /<script type="application\/json" data-island-props="marketHeader">([\s\S]*?)<\/script>/,
    );
    expect(match).toBeTruthy();
    const snapshot = JSON.parse((match?.[1] ?? "").replaceAll("\\u003c", "<"));
    expect(snapshot.slice).toBe("trade.active-symbol");
    expect(snapshot.props.view.symbol).toBe("BTC");
    expect(snapshot.props.view.mark).toBe("63,003.35");
    expect(snapshot.props.countdownLabel).toBe("08:00:00");
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

  it("renderMarketHeader tolerates an unknown symbol via the fixture fallback", async () => {
    // Unknown symbols fall back to BTC's fixture shape (still deterministic).
    const result = await renderMarketHeader(
      { props: { symbol: "DOGE" } },
      { now: () => 0 },
    );
    expect(result.statusCode).toBe(200);
    expect("html" in result.body && result.body.html).toContain(
      'data-fragment="market-header"',
    );
  });

  it("/metrics exposes Prometheus text after traffic", async () => {
    const server = buildServer();
    await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: { symbol: "BTC" } },
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
        ctx: { traceId: "trace-market-header-test" },
        props: { symbol: "BTC" },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(exported).toHaveLength(1);
    expect(exported[0].traceId).toBe("trace-market-header-test");
    const names = exported[0].nodes.map((node) => node.name);
    expect(names).toContain("request:/render");
    expect(names).toContain("render:market-header");
  });

  it("declares a fragment budget within the 30KB JS / 10KB CSS ceiling", () => {
    expect(marketHeaderBudget).toMatchObject({
      scope: "fragment",
      maxFragmentLatencyMs: 200,
    });
    expect(marketHeaderBudget.jsBytes).toBeLessThanOrEqual(30_000);
    expect(marketHeaderBudget.cssBytes).toBeLessThanOrEqual(10_000);
  });
});
