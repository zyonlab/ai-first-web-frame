import {
  configureTraceExport,
  type RequestTraceSnapshot,
  resetTraceExport,
} from "@mvp/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountBarBudget } from "../src/budget";
import { validateAccountBarManifest } from "../src/manifest";
import { renderAccountBar } from "../src/render";
import { buildServer } from "../src/server";

afterEach(() => {
  resetTraceExport();
  vi.restoreAllMocks();
});

describe("account-bar fragment service", () => {
  it("/ returns a browser-readable service demo", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("account-bar fragment");
    expect(response.body).toContain("POST http://localhost:4207/render");
    expect(response.body).toContain('data-fragment="account-bar"');
  });

  it("/health returns ok with service and uptime", async () => {
    let clock = 1000;
    const server = buildServer({ now: () => clock });
    clock = 1500;
    const response = await server.inject({ method: "GET", url: "/health" });
    const body = response.json();
    expect(body).toMatchObject({ status: "ok", service: "account-bar" });
    expect(body.uptimeMs).toBe(500);
  });

  it("/manifest passes schema validation", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/manifest" });
    expect(validateAccountBarManifest(response.json())).toBe(true);
  });

  it("/manifest declares dynamic-ssr + shared trade-client chunk + account dep", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/manifest" });
    const manifest = response.json();
    expect(manifest.renderStrategy).toBe("dynamic-ssr");
    expect(manifest.cachePolicy.ttl).toBe(0);
    expect(manifest.assets.js).toContain("@mvp/trade-client");
    expect(manifest.dataDependencies).toEqual(["account"]);
  });

  it("/assets returns js and css arrays with the shared chunk", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/assets" });
    expect(response.json()).toMatchObject({
      js: expect.arrayContaining(["@mvp/trade-client"]),
      css: expect.any(Array),
    });
  });

  it("/render emits a stable account bar from the frozen account fixture", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { ctx: { locale: "en-US" }, props: {} },
    });
    expect(response.statusCode).toBe(200);
    const html = response.json().html as string;
    // Numbers come only from the data plane (proves @mvp/data ran).
    expect(html).toContain('data-value="equity">100,092.00');
    expect(html).toContain('data-value="marginUsed">20,018.40');
    expect(html).toContain('data-value="withdrawable">80,073.60');
    expect(html).toContain('data-value="marginUsagePct">20.00%');
  });

  it("/render emits the C2 island mount markup + inline JSON snapshot", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: {} },
    });
    const html = response.json().html as string;
    expect(html).toContain('data-island="accountBar"');
    expect(html).toContain('data-island-props="accountBar"');
    const match = html.match(
      /<script type="application\/json" data-island-props="accountBar">([\s\S]*?)<\/script>/,
    );
    expect(match).toBeTruthy();
    const snapshot = JSON.parse((match?.[1] ?? "").replaceAll("\\u003c", "<"));
    expect(snapshot.slice).toBe("trade.leverage");
    expect(snapshot.props.view.equity).toBe("100,092.00");
    expect(snapshot.props.seededLeverage).toBe(1);
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

  it("renderAccountBar resolves the account frame through the data plane", async () => {
    const result = await renderAccountBar({ props: {} });
    expect(result.statusCode).toBe(200);
    expect("html" in result.body && result.body.html).toContain(
      'data-fragment="account-bar"',
    );
  });

  it("/metrics exposes Prometheus text after traffic", async () => {
    const server = buildServer();
    await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: {} },
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
        ctx: { traceId: "trace-account-bar-test" },
        props: {},
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(exported).toHaveLength(1);
    expect(exported[0].traceId).toBe("trace-account-bar-test");
    const names = exported[0].nodes.map((node) => node.name);
    expect(names).toContain("request:/render");
    expect(names).toContain("render:account-bar");
  });

  it("declares a fragment budget within the 30KB JS / 10KB CSS ceiling", () => {
    expect(accountBarBudget).toMatchObject({
      scope: "fragment",
      maxFragmentLatencyMs: 200,
    });
    expect(accountBarBudget.jsBytes).toBeLessThanOrEqual(30_000);
    expect(accountBarBudget.cssBytes).toBeLessThanOrEqual(10_000);
  });
});
