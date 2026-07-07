import {
  configureTraceExport,
  type RequestTraceSnapshot,
  resetTraceExport,
} from "@mvp/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tradesFeedBudget } from "../src/budget";
import { validateTradesFeedManifest } from "../src/manifest";
import { buildServer } from "../src/server";

afterEach(() => {
  resetTraceExport();
  vi.restoreAllMocks();
});

describe("trades-feed fragment service", () => {
  it("/ returns a browser-readable service demo", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("trades-feed fragment");
    expect(response.body).toContain("POST http://localhost:4206/render");
  });

  it("/health returns ok with service and uptime", async () => {
    let clock = 1000;
    const server = buildServer({ now: () => clock });
    clock = 1500;
    const response = await server.inject({ method: "GET", url: "/health" });
    const body = response.json();
    expect(body).toMatchObject({ status: "ok", service: "trades-feed" });
    expect(body.uptimeMs).toBe(500);
  });

  it("/manifest passes schema validation and declares realtime strategy", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/manifest" });
    const manifest = response.json();
    expect(validateTradesFeedManifest(manifest)).toBe(true);
    expect(manifest.renderStrategy).toBe("dynamic-ssr");
    expect(manifest.cachePolicy.ttl).toBe(0);
    expect(manifest.dataDependencies).toContain("trades.<symbol>");
  });

  it("/assets declares the shared trade-client + patch js and scoped css", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/assets" });
    const assets = response.json();
    expect(assets.js).toContain("@mvp/trade-client");
    expect(assets.js).toContain("/assets/trades-feed.patch.js");
    expect(assets.css).toContain("/assets/trades-feed.css");
  });

  it("/render injects a server-safe tape from the fixture (buy/sell, time, price, size)", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: { symbol: "BTC", limit: 10 } },
    });
    expect(response.statusCode).toBe(200);
    const { html } = response.json();
    expect(html).toContain('data-fragment="trades-feed"');
    expect(html).toContain('data-island="trades"');
    // Patch-only: no React shipped inline.
    expect(html).not.toContain("hydrate");
    // Rows keyed by seq, colored by side, with the three mono columns.
    expect(html).toContain("trades-tape__row--buy");
    expect(html).toContain("trades-tape__row--sell");
    expect(html).toMatch(/data-seq="\d+"/);
    expect(html).toContain("trades-tape__cell--time");
    expect(html).toContain("trades-tape__cell--price");
    expect(html).toContain("trades-tape__cell--size");
    // Inline island-props snapshot for first interactivity.
    expect(html).toContain('data-island-props="trades"');
  });

  it("/render is deterministic and caps to the requested limit, newest first", async () => {
    const server = buildServer();
    const inject = () =>
      server.inject({
        method: "POST",
        url: "/render",
        payload: { props: { symbol: "BTC", limit: 5 } },
      });
    const a = (await inject()).json().html as string;
    const b = (await inject()).json().html as string;
    expect(a).toBe(b);
    const seqs = [...a.matchAll(/data-seq="(\d+)"/g)].map((m) => Number(m[1]));
    expect(seqs.length).toBe(5);
    // Newest-first: strictly descending seqs.
    expect([...seqs].sort((x, y) => y - x)).toEqual(seqs);
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
      payload: { props: { symbol: "BTC", limit: 5 } },
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
    expect(budget).toMatchObject({ scope: "fragment", name: "trades-feed" });
    expect(budget.jsBytes).toBeLessThanOrEqual(30000);
    expect(budget.cssBytes).toBeLessThanOrEqual(10000);
    expect(tradesFeedBudget.jsBytes).toBeLessThanOrEqual(30000);
    expect(tradesFeedBudget.cssBytes).toBeLessThanOrEqual(10000);
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
        ctx: { traceId: "trace-trades-test" },
        props: { symbol: "BTC", limit: 5 },
      },
    });
    // exportTrace is fire-and-forget; allow the microtask to flush.
    await new Promise((resolve) => setImmediate(resolve));
    expect(exported).toHaveLength(1);
    expect(exported[0].traceId).toBe("trace-trades-test");
    const names = exported[0].nodes.map((node) => node.name);
    expect(names).toContain("request:/render");
    expect(names).toContain("render:trades-feed");
  });
});
