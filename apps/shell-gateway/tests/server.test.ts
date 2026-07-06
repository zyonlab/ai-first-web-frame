import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("shell-gateway", () => {
  it("/health returns ok", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });
    expect(response.json()).toMatchObject({ status: "ok" });
  });

  it("/manifest/routes returns route registry", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/manifest/routes",
    });
    expect(
      response.json().routes.map((route: { id: string }) => route.id),
    ).toContain("home");
  });

  it("/manifest/fragments returns fragment registry", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/manifest/fragments",
    });
    expect(response.json().fragments).toHaveProperty("promotion-banner");
  });

  it("/ resolves to page-home", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      expect(String(url)).toBe("http://localhost:4101/");
      return new Response(
        "<!doctype html><html><body><main>home page</main></body></html>",
        {
          status: 200,
          headers: { "content-type": "text/html" },
        },
      );
    }) as typeof fetch;
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/",
      headers: { "x-trace-id": "trace-home" },
    });
    expect(response.body).toContain("home page");
    expect(response.body).toContain('data-shell-gateway="true"');
    expect(response.body).toContain("@mvp/page-home");
    expect(response.headers["x-trace-id"]).toBe("trace-home");
  });

  it("/product/123 resolves to page-product", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      expect(String(url)).toBe("http://localhost:4102/product/123");
      return new Response("<main>product page</main>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/product/123",
    });
    expect(response.body).toContain("product page");
  });

  it("unknown route returns 404 fallback", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/missing" });
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain("data-shell-404");
  });

  it("page app error returns shell fallback", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("bad", { status: 500 }),
    ) as typeof fetch;
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(502);
    expect(response.body).toContain("data-shell-fallback");
  });

  it("sets security headers", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
  });
});
