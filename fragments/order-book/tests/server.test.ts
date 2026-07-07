import {
  configureTraceExport,
  type RequestTraceSnapshot,
  resetTraceExport,
} from "@mvp/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { orderBookBudget } from "../src/budget";
import { validateOrderBookManifest } from "../src/manifest";
import { buildServer } from "../src/server";

afterEach(() => {
  resetTraceExport();
  vi.restoreAllMocks();
});

describe("order-book fragment service", () => {
  it("/ returns a browser-readable service demo", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("order-book fragment");
    expect(response.body).toContain("POST http://localhost:4204/render");
  });

  it("/health returns ok with service and uptime", async () => {
    let clock = 1000;
    const server = buildServer({ now: () => clock });
    clock = 1400;
    const response = await server.inject({ method: "GET", url: "/health" });
    const body = response.json();
    expect(body).toMatchObject({ status: "ok", service: "order-book" });
    expect(body.uptimeMs).toBe(400);
  });

  it("/manifest passes schema validation and is dynamic-ssr realtime", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/manifest" });
    const manifest = response.json();
    expect(validateOrderBookManifest(manifest)).toBe(true);
    expect(manifest.renderStrategy).toBe("dynamic-ssr");
    expect(manifest.cachePolicy.ttl).toBe(0);
    expect(manifest.dataDependencies).toContain("book.l2.<symbol>");
  });

  it("/assets declares the shared trade-client chunk + patch client + css", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/assets" });
    const assets = response.json();
    expect(assets.js).toContain("@mvp/trade-client");
    expect(assets.css).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it("/budget stays within the 30KB JS / 10KB CSS hard gate", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/budget" });
    const budget = response.json();
    expect(budget.jsBytes).toBeLessThanOrEqual(30000);
    expect(budget.cssBytes).toBeLessThanOrEqual(10000);
    expect(orderBookBudget.scope).toBe("fragment");
  });

  it("/render returns valid ladder HTML for a symbol", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { ctx: { locale: "en-US" }, props: { symbol: "BTC" } },
    });
    expect(response.statusCode).toBe(200);
    const html = response.json().html;
    expect(html).toContain('data-fragment="order-book"');
    expect(html).toContain('data-island="book"');
    expect(html).toContain('data-value="62982.3"');
  });

  it("/render returns a safe fallback for a missing symbol", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { ctx: {} },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().html).toContain("data-fallback");
  });

  it("/metrics exposes Prometheus http + render histogram text", async () => {
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
        ctx: { traceId: "trace-order-book-test" },
        props: { symbol: "BTC" },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(exported).toHaveLength(1);
    expect(exported[0].traceId).toBe("trace-order-book-test");
    const names = exported[0].nodes.map((node) => node.name);
    expect(names).toContain("request:/render");
    expect(names).toContain("render:order-book");
  });
});
