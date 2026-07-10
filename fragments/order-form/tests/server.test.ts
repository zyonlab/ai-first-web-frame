import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  configureTraceExport,
  type RequestTraceSnapshot,
  resetTraceExport,
} from "@mvp/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { orderFormBudget } from "../src/budget";
import { validateOrderFormManifest } from "../src/manifest";
import { createOrderFormFallback } from "../src/render";
import { buildServer } from "../src/server";

// Mirrors `ISLAND_BROWSER_BUNDLE_PATH` in `../src/server.ts` (resolved
// relative to this file instead, since both `src/` and `tests/` are
// siblings at the fragment root — same target path either way).
const ISLAND_BUNDLE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist-browser",
  "island.browser.js",
);

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

  it("/assets lists the real served island bundle + stylesheet", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/assets" });
    const assets = response.json();
    // C3 spike: no more `@mvp/trade-client` (a package that no longer
    // exists — stale metadata nobody ever consumed) or bare `@mvp/ui/shadcn`
    // package-name placeholder; the one JS entry is the real served path.
    expect(assets.js).toEqual(["/assets/order-form.island.js"]);
    expect(assets.css).toEqual(["/assets/order-form.css"]);
  });

  describe("/assets/order-form.island.js (C3 spike, §4.3.3)", () => {
    afterEach(async () => {
      await rm(ISLAND_BUNDLE_PATH, { force: true });
    });

    it("serves the built browser bundle as real, fetchable JS", async () => {
      await mkdir(dirname(ISLAND_BUNDLE_PATH), { recursive: true });
      await writeFile(
        ISLAND_BUNDLE_PATH,
        'export function mountOrderFormIsland(){return "spike-bundle";}',
        "utf8",
      );
      const server = buildServer();
      const response = await server.inject({
        method: "GET",
        url: "/assets/order-form.island.js",
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/javascript");
      expect(response.body).toContain("mountOrderFormIsland");
      // Real spike finding, only caught by loading the real page in a real
      // browser (curl and this test don't enforce CORS): a page on a
      // different origin (apps/page-trade, localhost:4103) dynamically
      // `import()`ing this module is a cross-origin ES module fetch, which
      // the spec always performs in CORS mode. Without this header, Chrome
      // blocked the import outright with an opaque-response error.
      expect(response.headers["access-control-allow-origin"]).toBe("*");
    });

    it("returns a structured 404 when the browser bundle hasn't been built", async () => {
      await rm(ISLAND_BUNDLE_PATH, { force: true });
      const server = buildServer();
      const response = await server.inject({
        method: "GET",
        url: "/assets/order-form.island.js",
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("island-bundle-not-built");
    });
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
    const fallback = createOrderFormFallback("test-reason");
    expect(fallback.metadata.fallback).toBe(true);
    expect(fallback.html).toContain('data-fallback="true"');
  });
});
