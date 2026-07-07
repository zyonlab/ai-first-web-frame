import {
  configureTraceExport,
  type RequestTraceSnapshot,
  resetTraceExport,
} from "@mvp/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { orderFormBudget } from "../src/budget";
import { validateOrderFormManifest } from "../src/manifest";
import { buildServer } from "../src/server";

afterEach(() => {
  resetTraceExport();
  vi.restoreAllMocks();
});

describe("order-form fragment service", () => {
  it("/ returns a browser-readable service demo", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("order-form fragment");
    expect(response.body).toContain("POST http://localhost:4205/render");
    expect(response.body).toContain('data-island="orderForm"');
  });

  it("/health returns ok with service and uptime", async () => {
    let clock = 1000;
    const server = buildServer({ now: () => clock });
    clock = 1500;
    const response = await server.inject({ method: "GET", url: "/health" });
    const body = response.json();
    expect(body).toMatchObject({ status: "ok", service: "order-form" });
    expect(body.uptimeMs).toBe(500);
  });

  it("/manifest passes schema validation", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/manifest" });
    expect(validateOrderFormManifest(response.json())).toBe(true);
  });

  it("/assets lists shared chunks + island glue", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/assets" });
    const assets = response.json();
    expect(assets.js).toContain("@mvp/trade-client");
    expect(assets.css).toEqual(["/assets/order-form.css"]);
  });

  it("/budget returns the fragment budget", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/budget" });
    expect(response.json()).toMatchObject({
      scope: "fragment",
      name: "order-form",
    });
  });

  it("/render injects the form + island snapshot for a symbol", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { ctx: { locale: "en-US" }, props: { symbol: "eth" } },
    });
    expect(response.statusCode).toBe(200);
    const html = response.json().html;
    expect(html).toContain('data-symbol="ETH"');
    expect(html).toContain('data-island-props="orderForm"');
    // request-time account read surfaced into the margin preview
    expect(html).toContain("data-of-equity");
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

  it("/metrics exposes Prometheus text after traffic", async () => {
    const server = buildServer();
    await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: { symbol: "BTC" } },
    });
    const response = await server.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("# TYPE http_requests_total counter");
    expect(response.body).toContain('route="/render"');
    expect(response.body).toContain(
      "# TYPE fragment_render_duration_seconds histogram",
    );
  });

  it("/metrics and /health stay out of HTTP request metrics", async () => {
    const server = buildServer();
    await server.inject({ method: "GET", url: "/health" });
    const response = await server.inject({ method: "GET", url: "/metrics" });
    expect(response.body).not.toContain('route="/health"');
    expect(response.body).not.toContain('route="/metrics"');
  });

  it("/render exports a trace with the render span", async () => {
    const exported: RequestTraceSnapshot[] = [];
    const server = buildServer();
    configureTraceExport({
      exporters: [{ export: (snapshot) => void exported.push(snapshot) }],
    });
    await server.inject({
      method: "POST",
      url: "/render",
      payload: {
        ctx: { traceId: "trace-order-form-test" },
        props: { symbol: "BTC" },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(exported).toHaveLength(1);
    expect(exported[0].traceId).toBe("trace-order-form-test");
    const names = exported[0].nodes.map((node) => node.name);
    expect(names).toContain("request:/render");
    expect(names).toContain("render:order-form");
  });

  it("declares a fragment budget", () => {
    expect(orderFormBudget).toMatchObject({
      scope: "fragment",
      maxFragmentLatencyMs: 200,
    });
  });
});
