import {
  configureTraceExport,
  type RequestTraceSnapshot,
  resetTraceExport,
} from "@mvp/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openOrdersBudget } from "../src/budget";
import { validateOpenOrdersManifest } from "../src/manifest";
import { createOpenOrdersFallback } from "../src/render";
import { buildServer } from "../src/server";

afterEach(() => {
  resetTraceExport();
  vi.restoreAllMocks();
});

describe("open-orders fragment service", () => {
  it("/ returns a browser-readable service demo", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("open-orders fragment");
    expect(response.body).toContain("POST http://localhost:4209/render");
  });

  it("/health returns ok with service and uptime", async () => {
    let clock = 1000;
    const server = buildServer({ now: () => clock });
    clock = 1500;
    const response = await server.inject({ method: "GET", url: "/health" });
    const body = response.json();
    expect(body).toMatchObject({ status: "ok", service: "open-orders" });
    expect(body.uptimeMs).toBe(500);
  });

  it("/manifest passes schema validation and declares realtime strategy", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/manifest" });
    const manifest = response.json();
    expect(validateOpenOrdersManifest(manifest)).toBe(true);
    expect(manifest.renderStrategy).toBe("dynamic-ssr");
    expect(manifest.cachePolicy.ttl).toBe(0);
    expect(manifest.dataDependencies).toContain("orders");
  });

  it("/assets declares the shared trade-client + patch js and scoped css", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/assets" });
    const assets = response.json();
    // Dead "@mvp/trade-client" placeholder removed (package deleted in P1).
    expect(assets.js).not.toContain("@mvp/trade-client");
    expect(assets.js).toContain("/assets/open-orders.patch.js");
    expect(assets.css).toContain("/assets/open-orders.css");
  });

  it("/render injects a server-safe orders table from the fixture", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: { symbol: "BTC" } },
    });
    expect(response.statusCode).toBe(200);
    const { html } = response.json();
    expect(html).toContain('data-fragment="open-orders"');
    expect(html).toContain('data-island="openOrders"');
    // Patch-only: no React shipped inline.
    expect(html).not.toContain("hydrate");
    // Fixture row keyed by orderId, with a cancel control.
    expect(html).toContain('data-order-id="ord-1"');
    expect(html).toContain("data-oo-cancel");
    expect(html).toContain('data-island-props="openOrders"');
  });

  it("/render is deterministic", async () => {
    const server = buildServer();
    const inject = () =>
      server.inject({
        method: "POST",
        url: "/render",
        payload: { props: { symbol: "BTC" } },
      });
    const a = (await inject()).json().html as string;
    const b = (await inject()).json().html as string;
    expect(a).toBe(b);
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

  it("/budget stays within the fragment budget gates", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/budget" });
    const budget = response.json();
    expect(budget).toMatchObject({ scope: "fragment", name: "open-orders" });
    expect(budget.jsBytes).toBeLessThanOrEqual(30000);
    expect(budget.cssBytes).toBeLessThanOrEqual(10000);
    expect(openOrdersBudget.jsBytes).toBeLessThanOrEqual(30000);
    expect(openOrdersBudget.cssBytes).toBeLessThanOrEqual(10000);
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
        ctx: { traceId: "trace-open-orders-test" },
        props: { symbol: "BTC" },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(exported).toHaveLength(1);
    expect(exported[0].traceId).toBe("trace-open-orders-test");
    const names = exported[0].nodes.map((node) => node.name);
    expect(names).toContain("request:/render");
    expect(names).toContain("render:open-orders");
  });

  it("/render rejects a malformed envelope with a structured 400", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { ctx: "not-an-object" },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("invalid-render-request");
    expect(Array.isArray(body.error.issues)).toBe(true);
    expect(body.error.issues.length).toBeGreaterThan(0);
  });

  it("stamps metadata.fallback on the degraded render path", () => {
    const fallback = createOpenOrdersFallback("test-reason");
    expect(fallback.metadata.fallback).toBe(true);
    expect(fallback.html).toContain('data-fallback="true"');
  });
});
