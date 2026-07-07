import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server";

/**
 * Server-level tests mirroring the batch1 fragments. These exercise the fastify
 * wiring (/health uptime, /metrics, /manifest, /assets, /render). They may PEND
 * until the workspace is installed (fastify linked); the pure render + patch
 * logic is fully covered by render.test.ts / patch.test.ts without a server.
 */
describe("positions-table server", () => {
  it("serves /health with monotonic uptime", async () => {
    let t = 1000;
    const server = buildServer({ now: () => t });
    t = 1500;
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("positions-table");
    expect(body.uptimeMs).toBe(500);
    await server.close();
  });

  it("serves /manifest and /assets", async () => {
    const server = buildServer();
    const manifest = await server.inject({ method: "GET", url: "/manifest" });
    expect(manifest.json().name).toBe("positions-table");
    const assets = await server.inject({ method: "GET", url: "/assets" });
    expect(assets.json().js).toContain("@mvp/trade-client");
    await server.close();
  });

  it("serves /metrics in prometheus text form", async () => {
    const server = buildServer();
    const res = await server.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    await server.close();
  });

  it("POST /render returns the SSR positions table", async () => {
    const server = buildServer();
    const res = await server.inject({
      method: "POST",
      url: "/render",
      payload: { ctx: { locale: "en-US" } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.html).toContain('data-fragment="positions-table"');
    expect(body.metadata.name).toBe("positions-table");
    expect(body.cache.ttl).toBe(0);
    await server.close();
  });
});
