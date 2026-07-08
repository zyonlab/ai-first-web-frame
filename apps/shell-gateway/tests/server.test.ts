import type { RequestTrace, RequestTraceSnapshot } from "@mvp/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShellMetrics } from "../src/observability";
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

describe("shell-gateway chrome + theme/locale", () => {
  function stubPage() {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          "<!doctype html><html><head><title>t</title></head><body><main>home page</main></body></html>",
          { status: 200, headers: { "content-type": "text/html" } },
        ),
    ) as typeof fetch;
  }

  it("renders the global nav with every primary link", async () => {
    stubPage();
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.body).toContain('data-shell-nav="true"');
    expect(response.body).toContain("MVP Perps");
    expect(response.body).toContain('href="/trade/BTC"');
    expect(response.body).toContain('href="/markets"');
    expect(response.body).toContain('href="/portfolio"');
    expect(response.body).toContain('href="/vaults"');
    expect(response.body).toContain('href="/referrals"');
  });

  it("does not mark any primary link active on a non-nav route", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("<main>product</main>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ) as typeof fetch;
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/product/1" });
    // /product/1 matches no primary nav item -> no aria-current on a navlink.
    expect(response.body).not.toMatch(
      /mvp-shell-navlink[^>]*aria-current="page"/,
    );
    expect(response.body).toContain('data-shell-nav="true"');
  });

  it("defaults to data-theme=system + lang en-US with no cookies", async () => {
    stubPage();
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.body).toContain('data-theme="system"');
    expect(response.body).toContain('lang="en-US"');
  });

  it("renders data-theme=dark from the mvp_theme cookie", async () => {
    stubPage();
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/",
      headers: { cookie: "mvp_theme=dark" },
    });
    expect(response.body).toContain('data-theme="dark"');
  });

  it("renders lang=zh-CN from the mvp_locale cookie", async () => {
    stubPage();
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/",
      headers: { cookie: "mvp_locale=zh" },
    });
    expect(response.body).toContain('lang="zh-CN"');
  });

  it("injects the design-system theme variables into <head>", async () => {
    stubPage();
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.body).toContain("--mvp-color-surface-1");
    expect(response.body).toContain(':where([data-theme="dark"])');
  });

  it("/_shell/theme writes mvp_theme and 302s back to the origin", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/_shell/theme?value=dark&returnTo=%2Fmarkets",
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/markets");
    const setCookie = String(response.headers["set-cookie"]);
    expect(setCookie).toContain("mvp_theme=dark");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Secure");
    expect(setCookie).not.toContain("HttpOnly");
  });

  it("/_shell/locale writes mvp_locale and 302s back to the origin", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/_shell/locale?value=zh&returnTo=%2Fportfolio",
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/portfolio");
    expect(String(response.headers["set-cookie"])).toContain("mvp_locale=zh");
  });

  it("rejects an invalid theme value with 400", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/_shell/theme?value=neon",
    });
    expect(response.statusCode).toBe(400);
  });

  it("guards against open-redirect returnTo targets", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/_shell/theme?value=light&returnTo=https://evil.example",
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/");
  });

  it("forwards the resolved theme + locale to the page unit", async () => {
    const headers: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_url, init) => {
      Object.assign(
        headers,
        (init as RequestInit)?.headers as Record<string, string>,
      );
      return new Response("<main>ok</main>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;
    const server = buildServer();
    await server.inject({
      method: "GET",
      url: "/",
      headers: { cookie: "mvp_theme=dark; mvp_locale=zh" },
    });
    expect(headers["x-theme"]).toBe("dark");
    expect(headers["x-locale"]).toBe("zh-CN");
  });
});

describe("shell-gateway observability", () => {
  it("/health reports service and monotonic uptimeMs from an injected clock", async () => {
    let clock = 1000;
    const server = buildServer({ now: () => clock });
    clock = 1250;
    const response = await server.inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({
      status: "ok",
      service: "shell-gateway",
      uptimeMs: 250,
    });
  });

  it("/metrics exposes Prometheus text with the scrape content-type", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("<main>home page</main>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ) as typeof fetch;
    const metrics = createShellMetrics();
    const server = buildServer({ metrics });

    await server.inject({ method: "GET", url: "/" });
    const response = await server.inject({ method: "GET", url: "/metrics" });

    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.headers["content-type"]).toContain("version=0.0.4");
    expect(response.body).toContain("# TYPE http_requests_total counter");
    expect(response.body).toContain(
      "# TYPE http_request_duration_seconds histogram",
    );
    // Uses the low-cardinality route template, never the raw path.
    expect(response.body).toContain('route="/"');
    expect(response.body).toContain('method="GET"');
    expect(response.body).toContain('status="200"');
  });

  it("does not meter /metrics or /health to avoid self-observation noise", async () => {
    const metrics = createShellMetrics();
    const server = buildServer({ metrics });

    await server.inject({ method: "GET", url: "/health" });
    await server.inject({ method: "GET", url: "/metrics" });
    const response = await server.inject({ method: "GET", url: "/metrics" });

    expect(response.body).not.toContain('route="/metrics"');
    expect(response.body).not.toContain('route="/health"');
  });

  it("records the product route template rather than the raw path", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("<main>product</main>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ) as typeof fetch;
    const metrics = createShellMetrics();
    const server = buildServer({ metrics });

    await server.inject({ method: "GET", url: "/product/123" });
    await server.inject({ method: "GET", url: "/product/999" });
    const response = await server.inject({ method: "GET", url: "/metrics" });

    expect(response.body).toContain('route="/product/:id"');
    expect(response.body).not.toContain('route="/product/123"');
  });

  it("exports one trace per composed request through the pipeline", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("<main>home page</main>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ) as typeof fetch;
    const exportTrace = vi.fn(
      async (_trace: RequestTrace | RequestTraceSnapshot) => true,
    );
    const server = buildServer({ exportTrace });

    await server.inject({
      method: "GET",
      url: "/",
      headers: { "x-trace-id": "trace-observe" },
    });
    await server.close();

    expect(exportTrace).toHaveBeenCalledTimes(1);
    const trace = exportTrace.mock.calls[0]?.[0];
    if (!trace || !("toJSON" in trace)) {
      throw new Error("expected a live trace to be exported");
    }
    const snapshot = trace.toJSON();
    expect(snapshot.traceId).toBe("trace-observe");
    const spanNames = snapshot.nodes.map((node) => node.name);
    expect(spanNames).toContain("shell.compose");
    expect(spanNames).toContain("shell.route.match");
    expect(spanNames).toContain("shell.upstream.fetch");
  });

  it("does not export traces for /metrics or /health", async () => {
    const exportTrace = vi.fn(async () => true);
    const server = buildServer({ exportTrace });

    await server.inject({ method: "GET", url: "/health" });
    await server.inject({ method: "GET", url: "/metrics" });
    await server.close();

    expect(exportTrace).not.toHaveBeenCalled();
  });

  it("sets a Content-Security-Policy that permits composed pages' inline assets", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });
    const csp = response.headers["content-security-policy"];
    expect(csp).toContain("default-src 'self'");
    // Composed Next page apps need inline styles + Next's inline scripts.
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("injects the request nonce into the composed shell marker", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          "<!doctype html><html><body><main>home page</main></body></html>",
          { status: 200, headers: { "content-type": "text/html" } },
        ),
    ) as typeof fetch;
    const server = buildServer({ nonceFactory: () => "marker-nonce" });
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.body).toContain('nonce="marker-nonce"');
  });
});
