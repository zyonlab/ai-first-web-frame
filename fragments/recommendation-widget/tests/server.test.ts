import {
  configureTraceExport,
  type RequestTraceSnapshot,
  resetTraceExport,
} from "@mvp/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recommendationWidgetBudget } from "../src/budget";
import { validateRecommendationWidgetManifest } from "../src/manifest";
import { createRecommendationFallback } from "../src/render";
import { buildServer } from "../src/server";

afterEach(() => {
  resetTraceExport();
  vi.restoreAllMocks();
});

describe("recommendation-widget fragment service", () => {
  it("/ returns a browser-readable service demo", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("recommendation-widget fragment");
    expect(response.body).toContain("Recommended for you");
    expect(response.body).toContain("POST http://localhost:4202/render");
  });

  it("/health returns ok with service and uptime", async () => {
    let clock = 2000;
    const server = buildServer({ now: () => clock });
    clock = 2750;
    const response = await server.inject({ method: "GET", url: "/health" });
    const body = response.json();
    expect(body).toMatchObject({
      status: "ok",
      service: "recommendation-widget",
    });
    expect(body.uptimeMs).toBe(750);
  });

  it("/manifest passes schema validation", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/manifest" });
    expect(validateRecommendationWidgetManifest(response.json())).toBe(true);
  });

  it("/render returns recommendation HTML loaded via @mvp/data", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { ctx: { locale: "en-US" }, props: { scene: "home", limit: 2 } },
    });
    expect(response.json().html).toContain("Recommended for you");
    // Titles come only from the data source, proving the data plane ran.
    expect(response.json().html).toContain("Everyday Travel Pack");
  });

  it("honors limit", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: { limit: 1 } },
    });
    expect(response.json().html.match(/data-product-id/g)).toHaveLength(1);
  });

  it("/metrics exposes Prometheus text after traffic", async () => {
    const server = buildServer();
    await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: { scene: "home", limit: 2 } },
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
        ctx: { traceId: "trace-recommendation-test" },
        props: { scene: "home", limit: 2 },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(exported).toHaveLength(1);
    expect(exported[0].traceId).toBe("trace-recommendation-test");
    const names = exported[0].nodes.map((node) => node.name);
    expect(names).toContain("request:/render");
    expect(names).toContain("render:recommendation-widget");
  });

  it("declares a fragment budget", () => {
    expect(recommendationWidgetBudget).toMatchObject({
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
    const fallback = createRecommendationFallback("test-reason");
    expect(fallback.metadata.fallback).toBe(true);
    expect(fallback.html).toContain('data-fallback="true"');
  });
});
