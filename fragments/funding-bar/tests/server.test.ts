import {
  configureTraceExport,
  type RequestTraceSnapshot,
  resetTraceExport,
} from "@mvp/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fundingBarBudget } from "../src/budget";
import { validateFundingBarManifest } from "../src/manifest";
import { createFundingBarFallback } from "../src/render";
import { buildServer } from "../src/server";

// NOTE: this suite imports `../src/server`, which imports `fastify`. In a fresh
// working tree with no `pnpm install`, module resolution for `fastify` will
// fail — that is expected ("pend install"). The pure logic + render suites
// (`countdown.test.ts`, `render.test.ts`) cover the fragment behavior without a
// running server; once `pnpm install` has run this suite passes too.

afterEach(() => {
  resetTraceExport();
  vi.restoreAllMocks();
});

describe("funding-bar fragment service", () => {
  it("/ returns a browser-readable service demo", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("funding-bar fragment");
    expect(response.body).toContain("POST http://localhost:4210/render");
  });

  it("/health returns ok with service and uptime", async () => {
    let clock = 1000;
    const server = buildServer({ now: () => clock });
    clock = 1500;
    const response = await server.inject({ method: "GET", url: "/health" });
    const body = response.json();
    expect(body).toMatchObject({ status: "ok", service: "funding-bar" });
    expect(body.uptimeMs).toBe(500);
  });

  it("/manifest passes schema validation", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/manifest" });
    expect(validateFundingBarManifest(response.json())).toBe(true);
  });

  it("/assets returns css and declares zero framework JS", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/assets" });
    const body = response.json();
    expect(body.css).toEqual(
      expect.arrayContaining(["/assets/funding-bar.css"]),
    );
    // Pure SSR + CSS pulse: no framework JS shipped (the live per-second tick is
    // a P3 enhancement served as a built client asset).
    expect(body.js).toEqual([]);
  });

  it("/render returns funding HTML read via the data plane", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: { symbol: "BTC" } },
    });
    expect(response.statusCode).toBe(200);
    const { html } = response.json();
    expect(html).toContain('data-fragment="funding-bar"');
    expect(html).toContain("data-oracle=");
    expect(html).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("/render returns a safe fallback for missing symbol", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: {} },
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
    const body = response.body;
    expect(body).toContain("# TYPE http_requests_total counter");
    expect(body).toContain('route="/render"');
    expect(body).toContain("# TYPE fragment_render_duration_seconds histogram");
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
        ctx: { traceId: "trace-funding-test" },
        props: { symbol: "BTC" },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(exported).toHaveLength(1);
    expect(exported[0].traceId).toBe("trace-funding-test");
    const names = exported[0].nodes.map((node) => node.name);
    expect(names).toContain("request:/render");
    expect(names).toContain("render:funding-bar");
  });

  it("declares a fragment budget", () => {
    expect(fundingBarBudget).toMatchObject({
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
    const fallback = createFundingBarFallback("test-reason");
    expect(fallback.metadata.fallback).toBe(true);
    expect(fallback.html).toContain('data-fallback="true"');
  });
});
