import {
  configureTraceExport,
  type RequestTraceSnapshot,
  resetTraceExport,
} from "@mvp/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { promotionBannerBudget } from "../src/budget";
import { validatePromotionBannerManifest } from "../src/manifest";
import { createPromotionFallback } from "../src/render";
import { buildServer } from "../src/server";

afterEach(() => {
  resetTraceExport();
  vi.restoreAllMocks();
});

describe("promotion-banner fragment service", () => {
  it("/ returns a browser-readable service demo", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("promotion-banner fragment");
    expect(response.body).toContain("Limited time offer");
    expect(response.body).toContain("POST http://localhost:4201/render");
  });

  it("/health returns ok with service and uptime", async () => {
    let clock = 1000;
    const server = buildServer({ now: () => clock });
    clock = 1500;
    const response = await server.inject({ method: "GET", url: "/health" });
    const body = response.json();
    expect(body).toMatchObject({ status: "ok", service: "promotion-banner" });
    expect(body.uptimeMs).toBe(500);
  });

  it("/manifest passes schema validation", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/manifest" });
    expect(validatePromotionBannerManifest(response.json())).toBe(true);
  });

  it("/assets returns js and css arrays", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/assets" });
    expect(response.json()).toMatchObject({ js: [], css: expect.any(Array) });
  });

  it("/render returns localized HTML", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: {
        ctx: { locale: "zh-CN" },
        props: { scene: "home", campaignId: "summer" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().html).toContain("限时优惠");
  });

  it("/render surfaces data-plane content loaded via @mvp/data", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: { scene: "home", campaignId: "summer" } },
    });
    expect(response.statusCode).toBe(200);
    // "Summer Sale" only exists in the data source, proving the data plane ran.
    expect(response.json().html).toContain("Summer Sale");
    expect(response.json().html).toContain("data-headline");
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
      payload: { props: { scene: "home", campaignId: "summer" } },
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
    // Override the pipeline installed at build time with a capturing exporter.
    configureTraceExport({
      exporters: [{ export: (snapshot) => void exported.push(snapshot) }],
    });
    await server.inject({
      method: "POST",
      url: "/render",
      payload: {
        ctx: { traceId: "trace-promotion-test" },
        props: { scene: "home", campaignId: "summer" },
      },
    });
    // exportTrace is fire-and-forget; allow the microtask to flush.
    await new Promise((resolve) => setImmediate(resolve));
    expect(exported).toHaveLength(1);
    expect(exported[0].traceId).toBe("trace-promotion-test");
    const names = exported[0].nodes.map((node) => node.name);
    expect(names).toContain("request:/render");
    expect(names).toContain("render:promotion-banner");
  });

  it("declares a fragment budget", () => {
    expect(promotionBannerBudget).toMatchObject({
      scope: "fragment",
      maxFragmentLatencyMs: 200,
    });
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
    const fallback = createPromotionFallback("test-reason");
    expect(fallback.metadata.fallback).toBe(true);
    expect(fallback.html).toContain('data-fallback="true"');
  });
});
