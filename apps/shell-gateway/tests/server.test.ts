import type { RequestTrace, RequestTraceSnapshot } from "@mvp/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShellMetrics } from "../src/observability";
import {
  buildServer,
  clearFragmentProxyCache,
  crawlableRoutes,
  primeFragmentProxyCache,
} from "../src/server";

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

  it("/ transparently proxies page-home HTML byte-for-byte", async () => {
    const upstream =
      "<!doctype html><html><body><main>home page</main></body></html>";
    globalThis.fetch = vi.fn(async (url) => {
      expect(String(url)).toBe("http://localhost:4101/");
      return new Response(upstream, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/",
      headers: { "x-trace-id": "trace-home" },
    });
    // Transparent proxy: upstream HTML returned unchanged, no injected chrome.
    expect(response.body).toBe(upstream);
    expect(response.body).not.toContain("data-shell-gateway");
    expect(response.body).not.toContain("data-shell-nav");
    // Trace header is still set by the shell response hook.
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

  it("reverse-proxies /_next/* assets to the page origin from the Referer", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      // Resolved from the Referer's route (page-home @ 4101).
      expect(String(url)).toBe(
        "http://localhost:4101/_next/static/chunks/main.js",
      );
      return new Response("console.log('bundle')", {
        status: 200,
        headers: {
          "content-type": "application/javascript",
          "cache-control": "public, max-age=31536000",
        },
      });
    }) as typeof fetch;
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/_next/static/chunks/main.js",
      headers: { referer: "http://localhost:4100/" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "application/javascript",
    );
    expect(response.headers["cache-control"]).toContain("max-age=31536000");
    expect(response.body).toContain("bundle");
  });

  it("404s a /_next asset request that can't resolve an origin", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/_next/static/x.js",
    });
    expect(response.statusCode).toBe(404);
  });

  it("sets security headers", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
  });
});

describe("shell-gateway transparent proxy + theme/locale", () => {
  const PAGE_HTML =
    '<!doctype html><html><head><title>t</title></head><body><header data-shell-nav="true">MVP Perps</header><main>home page</main></body></html>';

  function stubPage() {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(PAGE_HTML, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ) as typeof fetch;
  }

  it("returns the upstream page HTML unchanged (no shell-injected chrome)", async () => {
    stubPage();
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    // The nav is now part of the page's own SSR output — the shell passes it
    // through verbatim rather than injecting/wrapping its own.
    expect(response.body).toBe(PAGE_HTML);
    // No shell-owned route marker or theme head is added on top.
    expect(response.body).not.toContain("data-shell-gateway");
    expect(response.body).not.toContain(':where([data-theme="dark"])');
  });

  it("does not rewrite <html> data-theme/lang (the page owns theme now)", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          '<!doctype html><html lang="en-US" data-theme="dark"><body><main>ok</main></body></html>',
          { status: 200, headers: { "content-type": "text/html" } },
        ),
    ) as typeof fetch;
    const server = buildServer();
    // Cookie present, but the shell must NOT mutate the upstream <html> tag.
    const response = await server.inject({
      method: "GET",
      url: "/",
      headers: { cookie: "mvp_theme=light; mvp_locale=zh" },
    });
    expect(response.body).toContain('lang="en-US"');
    expect(response.body).toContain('data-theme="dark"');
  });

  it("preserves the upstream status code and content-type", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(PAGE_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    ) as typeof fetch;
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
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

  it("does not stamp the per-request nonce into the proxied body", async () => {
    const upstream =
      "<!doctype html><html><body><main>home page</main></body></html>";
    globalThis.fetch = vi.fn(
      async () =>
        new Response(upstream, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ) as typeof fetch;
    const server = buildServer({ nonceFactory: () => "marker-nonce" });
    const response = await server.inject({ method: "GET", url: "/" });
    // Transparent proxy: the shell no longer injects a nonced marker/head, so the
    // nonce never leaks into the HTML body; the body is the upstream verbatim.
    expect(response.body).toBe(upstream);
    expect(response.body).not.toContain("marker-nonce");
  });

  it("passes an abort signal on the page proxy and degrades when it fires", async () => {
    let observed: AbortSignal | undefined;
    globalThis.fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          observed = init?.signal ?? undefined;
          observed?.addEventListener("abort", () =>
            reject(new Error("The operation was aborted")),
          );
        }),
    ) as typeof fetch;
    const server = buildServer({ pageTimeoutMs: 10 });
    const response = await server.inject({ method: "GET", url: "/" });
    // A hung page must not hold the gateway request open: it degrades to the
    // shell fallback instead.
    expect(response.statusCode).toBe(502);
    expect(observed?.aborted).toBe(true);
  });

  it("passes an abort signal on the asset proxy", async () => {
    let observed: AbortSignal | undefined;
    globalThis.fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          observed = init?.signal ?? undefined;
          observed?.addEventListener("abort", () =>
            reject(new Error("The operation was aborted")),
          );
        }),
    ) as typeof fetch;
    const server = buildServer({ assetTimeoutMs: 10 });
    const response = await server.inject({
      method: "GET",
      url: "/_next/static/chunk.js",
      headers: { referer: "http://localhost:4100/" },
    });
    expect(response.statusCode).toBe(502);
    expect(observed?.aborted).toBe(true);
  });

  it("serves robots.txt pointing at the sitemap on the public origin", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/robots.txt",
      headers: { host: "perps.example" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("User-agent: *");
    expect(response.body).toContain(
      "Sitemap: http://perps.example/sitemap.xml",
    );
    // Operator surfaces stay out of the index.
    expect(response.body).toContain("Disallow: /manifest/");
    expect(response.body).toContain("Disallow: /_shell/");
  });

  it("serves a sitemap of the static routes only, from the route registry", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/sitemap.xml",
      headers: { host: "perps.example" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/xml");
    expect(response.body).toContain("<loc>http://perps.example/</loc>");
    expect(response.body).toContain("<loc>http://perps.example/markets</loc>");
    // Parameterized templates are not URLs and must never be published.
    expect(response.body).not.toContain(":id");
    expect(response.body).not.toContain(":symbol");
  });

  it("honors x-forwarded-proto/host so the sitemap is right behind a CDN", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/sitemap.xml",
      headers: {
        host: "internal:4100",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "perps.example",
      },
    });
    expect(response.body).toContain("<loc>https://perps.example/</loc>");
  });

  it("crawlableRoutes excludes every parameterized route", () => {
    const routes = crawlableRoutes();
    expect(routes).toContain("/");
    expect(routes.some((path) => path.includes(":"))).toBe(false);
  });

  it("answers 503 + Retry-After when a page reports a failed required slot", async () => {
    // Tailor's `primary` semantic: a page whose REQUIRED slot is down must not
    // be served as 200, or crawlers index degraded markup as real content.
    const upstream =
      '<!doctype html><html><body><div hidden data-mvp-page-health="unhealthy" data-failed-slots="promotion"></div><main data-page="home">degraded</main></body></html>';
    globalThis.fetch = vi.fn(
      async () =>
        new Response(upstream, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ) as typeof fetch;
    const response = await buildServer().inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("5");
    expect(response.headers["x-mvp-page-health"]).toContain("promotion");
    // The body is still returned byte-for-byte — a reader sees what did render.
    expect(response.body).toBe(upstream);
  });

  it("leaves a degraded (optional-slot) page at 200", async () => {
    const upstream =
      '<!doctype html><html><body><div hidden data-mvp-page-health="degraded" data-failed-slots=""></div>ok</body></html>';
    globalThis.fetch = vi.fn(
      async () =>
        new Response(upstream, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ) as typeof fetch;
    const response = await buildServer().inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["retry-after"]).toBeUndefined();
  });

  it("leaves a page without the marker untouched (pages opt in)", async () => {
    const upstream = "<!doctype html><html><body>no marker</body></html>";
    globalThis.fetch = vi.fn(
      async () =>
        new Response(upstream, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ) as typeof fetch;
    const response = await buildServer().inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
  });

  it("can be disabled so a stabilizing deployment keeps the upstream status", async () => {
    const upstream =
      '<!doctype html><html><body><div hidden data-mvp-page-health="unhealthy"></div>x</body></html>';
    globalThis.fetch = vi.fn(
      async () =>
        new Response(upstream, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ) as typeof fetch;
    const response = await buildServer({ requiredFailureStatus: 0 }).inject({
      method: "GET",
      url: "/",
    });
    expect(response.statusCode).toBe(200);
  });

  it("proxies a fragment-declared backend target on the public origin", async () => {
    // The channel a hydrated island uses to reach its own backend: same-origin,
    // no CORS, and the fragment's service address never reaches the browser.
    clearFragmentProxyCache();
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push(String(url));
      if (String(url).endsWith("/manifest")) {
        return new Response(
          JSON.stringify({
            name: "promotion-banner",
            version: "0.1.0",
            proxy: { campaigns: "https://campaigns.internal/v1" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // Assert the context headers rode along with the proxied call.
      const headers = new Headers(init?.headers as HeadersInit);
      expect(headers.get("x-tenant")).toBeTruthy();
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const server = buildServer();
    await primeFragmentProxyCache();
    const response = await server.inject({
      method: "GET",
      url: "/_fragment/promotion-banner/campaigns/summer?limit=3",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(calls).toContain("https://campaigns.internal/v1/summer?limit=3");
    // Per-request data must never be cached at the gateway.
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("forwards a non-JSON body and its content-type unmangled", async () => {
    // The first version JSON.stringify'd every body, which corrupts text/form
    // payloads and mislabels them as application/json.
    clearFragmentProxyCache();
    let seenBody: unknown;
    let seenType: string | null = null;
    globalThis.fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith("/manifest")) {
        return new Response(
          JSON.stringify({ proxy: { notes: "https://notes.internal/v1" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      seenBody = init?.body;
      seenType = new Headers(init?.headers as HeadersInit).get("content-type");
      return new Response("stored", { status: 201 });
    }) as typeof fetch;

    const server = buildServer();
    await primeFragmentProxyCache();
    const response = await server.inject({
      method: "POST",
      url: "/_fragment/promotion-banner/notes",
      headers: { "content-type": "text/plain" },
      payload: "a plain text note",
    });
    expect(response.statusCode).toBe(201);
    expect(seenBody).toBe("a plain text note");
    expect(seenType).toBe("text/plain");
  });

  it("re-serializes a parsed JSON body", async () => {
    clearFragmentProxyCache();
    let seenBody: unknown;
    globalThis.fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith("/manifest")) {
        return new Response(
          JSON.stringify({ proxy: { notes: "https://notes.internal/v1" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      seenBody = init?.body;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const server = buildServer();
    await primeFragmentProxyCache();
    await server.inject({
      method: "POST",
      url: "/_fragment/promotion-banner/notes",
      headers: { "content-type": "application/json" },
      payload: { size: 3 },
    });
    expect(seenBody).toBe('{"size":3}');
  });

  it("404s an unknown fragment or an undeclared target, with the reason", async () => {
    clearFragmentProxyCache();
    globalThis.fetch = vi.fn(async (url) =>
      String(url).endsWith("/manifest")
        ? new Response(JSON.stringify({ proxy: {} }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : new Response("should not be called", { status: 500 }),
    ) as typeof fetch;
    const server = buildServer();
    await primeFragmentProxyCache();

    const unknownFragment = await server.inject({
      method: "GET",
      url: "/_fragment/ghost-fragment/anything",
    });
    expect(unknownFragment.statusCode).toBe(404);
    expect(unknownFragment.json().error.reason).toBe("unknown-fragment");

    const unknownTarget = await server.inject({
      method: "GET",
      url: "/_fragment/promotion-banner/not-declared",
    });
    expect(unknownTarget.statusCode).toBe(404);
    expect(unknownTarget.json().error.reason).toBe("unknown-target");
  });

  it("502s when the fragment backend fails, and carries an abort signal", async () => {
    clearFragmentProxyCache();
    let observed: AbortSignal | undefined;
    globalThis.fetch = vi.fn((url, init) => {
      if (String(url).endsWith("/manifest")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ proxy: { slow: "https://slow.internal/v1" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return new Promise<Response>((_resolve, reject) => {
        observed = (init as RequestInit | undefined)?.signal ?? undefined;
        observed?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }) as typeof fetch;
    const server = buildServer({ fragmentProxyTimeoutMs: 10 });
    await primeFragmentProxyCache();
    const response = await server.inject({
      method: "GET",
      url: "/_fragment/promotion-banner/slow/x",
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("fragment-proxy-failed");
    expect(observed?.aborted).toBe(true);
  });
});
