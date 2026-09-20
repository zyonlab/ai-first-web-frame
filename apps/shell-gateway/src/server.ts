import { pathToFileURL } from "node:url";
import {
  createRequestTrace,
  exportTrace as defaultExportTrace,
  type RequestTrace,
} from "@mvp/observability";
import { fragmentRegistry } from "@mvp/registry";
import { matchRoute, routeRegistry } from "@mvp/routes";
import {
  FRAGMENT_PROXY_PREFIX,
  readPageHealthFromHtml,
  resolveFragmentProxy,
} from "@mvp/runtime";
import {
  type LocalePreference,
  type ThemePreference,
  writeLocalePreference,
  writeThemePreference,
} from "@mvp/trade-prefs";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createFragmentHeaders, createShellRequestContext } from "./context";
import { createNotFoundFallback, createShellFallback } from "./fallback";
import {
  createContentSecurityPolicy,
  createNonce,
  createShellMetrics,
  ensureTraceExportConfigured,
  isMeteredRoute,
  PROMETHEUS_CONTENT_TYPE,
  type ShellMetrics,
} from "./observability";

/**
 * Upstream timeouts. Node's `fetch` has none and Fastify adds none, so before
 * these a hung page process held a gateway request open indefinitely — on the
 * one component every request passes through. Both are overridable per
 * deployment; the page budget is generous because a composed page itself
 * schedules fragment calls behind its own (200ms) timeouts.
 */
export const DEFAULT_PAGE_FETCH_TIMEOUT_MS = 5_000;
export const DEFAULT_ASSET_FETCH_TIMEOUT_MS = 10_000;

/**
 * Status a composed page answers with when one of its REQUIRED slots is
 * entirely down — Tailor's `primary` semantic, which this gateway had no
 * equivalent of.
 *
 * Until now such a page answered `200`: the degraded markup was indexed by
 * crawlers as real content and success-rate monitoring saw a healthy page.
 * `503` + `Retry-After` says "this is temporarily not the real page" while the
 * body is still returned unchanged, so a human reader still sees whatever did
 * render. An OPTIONAL slot failing is untouched and stays `200`, because
 * partial degradation is a designed feature.
 */
export const DEFAULT_REQUIRED_FAILURE_STATUS = 503;
export const DEFAULT_RETRY_AFTER_SECONDS = 5;

/** Upstream timeout for a fragment-declared backend proxy. */
export const DEFAULT_FRAGMENT_PROXY_TIMEOUT_MS = 6_000;

/**
 * Per-fragment `proxy` maps, cached by the version the registry currently
 * resolves to. Keying on version is exactly how Podium uses its manifest
 * `version` field: a promote changes the version, which invalidates this entry,
 * so a redeployed fragment's new proxy targets are picked up without a gateway
 * restart and without re-fetching a manifest on every request.
 */
type ProxyManifestEntry = { version: string; proxy: Record<string, string> };
const proxyManifestCache = new Map<string, ProxyManifestEntry>();

/** Test hook: forget every cached fragment manifest. */
export function clearFragmentProxyCache(): void {
  proxyManifestCache.clear();
}

/**
 * A timeout signal that works on every runtime this file runs in. Node 18+ has
 * `AbortSignal.timeout`, but the happy-dom test environment replaces the global
 * `AbortSignal` with its own implementation that lacks it — so a bare
 * `AbortSignal.timeout(ms)` throws there and every proxied request degrades.
 * `dispose()` clears the fallback timer once the request settles.
 */
export function createUpstreamTimeout(ms: number): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const native = (
    AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }
  ).timeout;
  if (typeof native === "function") {
    return { signal: native.call(AbortSignal, ms), dispose: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  (timer as unknown as { unref?: () => void }).unref?.();
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

/** 0 is meaningful here ("keep the upstream status"), so it is not falsy-coerced. */
function statusFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed < 600
    ? parsed
    : fallback;
}

function timeoutFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type BuildServerOptions = {
  /** Monotonic clock in milliseconds, injected for deterministic tests. */
  now?: () => number;
  /** Upstream page-proxy timeout; see {@link DEFAULT_PAGE_FETCH_TIMEOUT_MS}. */
  pageTimeoutMs?: number;
  /** Upstream asset-proxy timeout; see {@link DEFAULT_ASSET_FETCH_TIMEOUT_MS}. */
  assetTimeoutMs?: number;
  /** Upstream timeout for fragment backend proxies. */
  fragmentProxyTimeoutMs?: number;
  /**
   * Status for a page that reported `health: "unhealthy"`. Set to 0 (or
   * `SHELL_REQUIRED_FAILURE_STATUS=0`) to keep the upstream status, which is
   * what a deployment wants while it is still stabilizing a new fragment.
   */
  requiredFailureStatus?: number;
  /** Shared process-level metrics surface; a fresh one is created by default. */
  metrics?: ShellMetrics;
  /** Per-request CSP nonce factory, overridable in tests. */
  nonceFactory?: () => string;
  /** Trace export sink; defaults to the globally configured pipeline. */
  exportTrace?: typeof defaultExportTrace;
};

/** Per-request observability state carried between hooks. */
type RequestState = {
  nonce: string;
  routeTemplate: string;
  startedAtMs: number;
  trace?: RequestTrace;
};

const requestState = new WeakMap<FastifyRequest, RequestState>();

export function buildServer(options: BuildServerOptions = {}) {
  const now = options.now ?? (() => performance.now());
  const metrics = options.metrics ?? createShellMetrics();
  const nonceFactory = options.nonceFactory ?? createNonce;
  const exportTrace = options.exportTrace ?? defaultExportTrace;
  const pageTimeoutMs =
    options.pageTimeoutMs ??
    timeoutFromEnv("SHELL_PAGE_TIMEOUT_MS", DEFAULT_PAGE_FETCH_TIMEOUT_MS);
  const assetTimeoutMs =
    options.assetTimeoutMs ??
    timeoutFromEnv("SHELL_ASSET_TIMEOUT_MS", DEFAULT_ASSET_FETCH_TIMEOUT_MS);
  const fragmentProxyTimeoutMs =
    options.fragmentProxyTimeoutMs ??
    timeoutFromEnv(
      "SHELL_FRAGMENT_PROXY_TIMEOUT_MS",
      DEFAULT_FRAGMENT_PROXY_TIMEOUT_MS,
    );
  const requiredFailureStatus =
    options.requiredFailureStatus ??
    statusFromEnv(
      "SHELL_REQUIRED_FAILURE_STATUS",
      DEFAULT_REQUIRED_FAILURE_STATUS,
    );
  const bootMs = now();

  const server = Fastify({ logger: false });

  server.addHook("onRequest", async (request, reply) => {
    const nonce = nonceFactory();
    requestState.set(request, {
      nonce,
      routeTemplate: request.url,
      startedAtMs: now(),
    });
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
    reply.header("x-shell-cache", "route-registry");
    reply.header("content-security-policy", createContentSecurityPolicy(nonce));
  });

  server.addHook("onResponse", async (request, reply) => {
    const state = requestState.get(request);
    if (!state) return;
    const durationMs = now() - state.startedAtMs;
    if (isMeteredRoute(state.routeTemplate)) {
      metrics.http.recordRequest({
        method: request.method,
        route: state.routeTemplate,
        statusCode: reply.statusCode,
        durationMs,
      });
    }
    if (state.trace) {
      // Fire-and-forget so trace export never blocks the response body.
      void exportTrace(state.trace).catch(() => {
        /* exporters own their error reporting */
      });
    }
  });

  server.get("/health", async () => ({
    status: "ok",
    service: "shell-gateway",
    uptimeMs: Math.max(0, now() - bootMs),
  }));

  server.get("/metrics", async (_request, reply) => {
    reply.type(PROMETHEUS_CONTENT_TYPE);
    return metrics.registry.toPrometheusText();
  });

  // ── Crawler surface ──────────────────────────────────────────────────────
  // The shell is the single public origin for all seven page apps, so it is the
  // only place robots.txt and the sitemap can be correct. Neither existed
  // anywhere in the repo: the site had no crawlable index at all, and a page was
  // discoverable only by inbound link. Both are derived from the route registry,
  // so adding a route extends them with no second list to maintain.
  server.get("/robots.txt", async (request, reply) => {
    reply.type("text/plain; charset=utf-8");
    reply.header("cache-control", "public, max-age=3600");
    return createRobotsTxt(publicOrigin(request));
  });

  server.get("/sitemap.xml", async (request, reply) => {
    reply.type("application/xml; charset=utf-8");
    reply.header("cache-control", "public, max-age=3600");
    return createSitemapXml(publicOrigin(request));
  });

  server.get("/manifest/routes", async () => routeRegistry);
  server.get("/manifest/fragments", async () => fragmentRegistry);

  // Shell-owned theme / locale switch endpoints. No-JS safe: a plain GET link
  // writes the public preference cookie via `@mvp/storage` and 302s back to the
  // origin page, so the next SSR render paints the new theme/locale with no flash.
  server.get("/_shell/theme", async (request, reply) => {
    const value = normalizeTheme(readQuery(request, "value"));
    if (!value) return badPref(reply, "theme");
    const { setCookie } = writeThemePreference(value);
    return redirectWithCookie(request, reply, setCookie);
  });

  server.get("/_shell/locale", async (request, reply) => {
    const value = normalizeLocale(readQuery(request, "value"));
    if (!value) return badPref(reply, "locale");
    const { setCookie } = writeLocalePreference(value);
    return redirectWithCookie(request, reply, setCookie);
  });

  /**
   * Fragment-declared backend proxy (`FragmentManifest.proxy`).
   *
   * `/_fragment/<fragment>/<target>/*` forwards to the URL that fragment's own
   * manifest declared for `<target>`. This is the channel a hydrated island uses
   * to reach its backend: same-origin (no CORS), and the fragment's real service
   * address never reaches the browser. Modelled on `@podium/proxy`, which mounts
   * the same idea at `{pathname}/{prefix}/{podletName}/{proxyName}/`.
   *
   * Registered before `/_next/*` and `/*` so it wins.
   */
  server.all(`${FRAGMENT_PROXY_PREFIX}/*`, async (request, reply) => {
    const requestUrl = new URL(request.url, "http://shell.local");
    const resolution = resolveFragmentProxy({
      pathname: requestUrl.pathname,
      search: requestUrl.search,
      proxyTargets: (name) => proxyTargetsFor(name),
      serviceUrlFor: (name) => resolveFragmentEntry(name)?.serviceUrl,
    });
    if (!resolution.ok) {
      // 404 for "no such route/target", never a redirect or a guess.
      reply.code(404).type("application/json");
      return {
        error: { code: "fragment-proxy-unresolved", reason: resolution.reason },
      };
    }

    const ctx = createShellRequestContext(request);
    const inboundContentType = firstHeaderValue(
      request.headers["content-type"],
    );
    const timeout = createUpstreamTimeout(fragmentProxyTimeoutMs);
    try {
      const upstream = await fetch(resolution.url, {
        method: request.method,
        headers: {
          // The same context a fragment gets on `/render`, so a proxied call is
          // as tenant/locale/trace-aware as the SSR path.
          ...createFragmentHeaders(ctx),
          accept: request.headers.accept ?? "*/*",
          // Preserve the caller's own content type instead of assuming JSON —
          // `createFragmentHeaders` sets `application/json` for /render, which
          // would mislabel a form or text body forwarded through here.
          ...(inboundContentType ? { "content-type": inboundContentType } : {}),
        },
        body: forwardBody(request),
        signal: timeout.signal,
      });
      reply.code(upstream.status);
      const contentType = upstream.headers.get("content-type");
      if (contentType) reply.type(contentType);
      // Proxied data is per-request by nature; caching it here would be a
      // correctness bug, not an optimization.
      reply.header("cache-control", "no-store");
      return Buffer.from(await upstream.arrayBuffer());
    } catch (error) {
      reply.code(502).type("application/json");
      return {
        error: {
          code: "fragment-proxy-failed",
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    } finally {
      timeout.dispose();
    }
  });

  // Composed Next page apps reference their client bundle + built CSS under
  // `/_next/*`, which the browser requests from the shell origin. The shell must
  // reverse-proxy those to the owning page (resolved from the Referer's route)
  // or hydration/styling break with 404s. Registered before `/*` so it wins.
  server.get("/_next/*", async (request, reply) => {
    const origin = pageOriginFromReferer(request);
    if (!origin) {
      reply.code(404).type("text/plain");
      return "asset origin not resolved";
    }
    const assetTimeout = createUpstreamTimeout(assetTimeoutMs);
    try {
      const upstream = await fetch(`${origin}${request.url}`, {
        headers: { accept: request.headers.accept ?? "*/*" },
        signal: assetTimeout.signal,
      });
      reply.code(upstream.status);
      const contentType = upstream.headers.get("content-type");
      if (contentType) reply.type(contentType);
      const cacheControl = upstream.headers.get("cache-control");
      if (cacheControl) reply.header("cache-control", cacheControl);
      return Buffer.from(await upstream.arrayBuffer());
    } catch {
      reply.code(502).type("text/plain");
      return "asset proxy failed";
    } finally {
      assetTimeout.dispose();
    }
  });

  server.get("/*", async (request, reply) => {
    const ctx = createShellRequestContext(request);
    const trace = createRequestTrace({
      traceId: ctx.traceId,
      requestId: ctx.requestId,
      now,
    });
    const requestSpan = trace.startSpan("shell.compose", "request", {
      attributes: { method: request.method },
    });

    reply.header("x-trace-id", ctx.traceId);
    reply.header("server-timing", "shell;dur=1");

    const pathname = new URL(request.url, "http://shell.local").pathname;
    const routeSpan = trace.startSpan("shell.route.match", "custom", {
      parentId: requestSpan,
      attributes: { pathname },
    });
    const route = matchRoute(pathname);
    trace.endSpan(routeSpan, {
      status: route ? "ok" : "error",
      attributes: { matched: Boolean(route), page: route?.page },
    });

    setRequestTrace(request, trace, route?.path ?? "unmatched");

    if (!route) {
      trace.endSpan(requestSpan, { status: "error" });
      reply.code(404).type("text/html");
      return createNotFoundFallback(pathname);
    }

    const upstreamSpan = trace.startSpan("shell.upstream.fetch", "network", {
      parentId: requestSpan,
      attributes: { page: route.page, serviceUrl: route.serviceUrl },
    });
    const pageTimeout = createUpstreamTimeout(pageTimeoutMs);
    try {
      const response = await fetch(`${route.serviceUrl}${pathname}`, {
        headers: createFragmentHeaders(ctx),
        signal: pageTimeout.signal,
      });

      if (!response.ok)
        throw new Error(`page ${route.page} returned ${response.status}`);

      trace.endSpan(upstreamSpan, {
        status: "ok",
        attributes: { statusCode: response.status },
      });
      trace.endSpan(requestSpan, { status: "ok" });

      // Transparent proxy: the composed page owns its own navigation chrome +
      // theme/locale head (rendered inside its own React tree), so the shell
      // returns the upstream HTML BYTE-FOR-BYTE. Injecting nav here previously
      // broke Next hydration (React #418) because the shell-added DOM diverged
      // from the client's SSR expectation.
      const body = await response.text();

      // Read-only inspection of that same body — the bytes are still returned
      // untouched. A page that stamps `health: "unhealthy"` had a REQUIRED slot
      // fail, and the response status is corrected to say so; pages that do not
      // stamp the marker are unaffected.
      const pageHealth = readPageHealthFromHtml(body);
      const requiredFailed =
        requiredFailureStatus > 0 && pageHealth?.health === "unhealthy";
      if (requiredFailed) {
        reply.header("retry-after", String(DEFAULT_RETRY_AFTER_SECONDS));
        reply.header(
          "x-mvp-page-health",
          `unhealthy; slots=${pageHealth.failedSlots.join(",")}`,
        );
      }
      reply
        .code(requiredFailed ? requiredFailureStatus : response.status)
        .type(response.headers.get("content-type") ?? "text/html");
      return body;
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "page proxy failed";
      trace.endSpan(upstreamSpan, {
        status: "error",
        attributes: { error: reason },
      });
      trace.endSpan(requestSpan, { status: "error" });
      reply.code(502).type("text/html");
      return createShellFallback(pathname, ctx.traceId, reason);
    } finally {
      pageTimeout.dispose();
    }
  });

  return server;
}

/**
 * The origin crawlers see. `PUBLIC_SITE_ORIGIN` wins (it is what the page apps'
 * canonicals are built from, so the two must agree); otherwise it is derived
 * from the request, honoring `x-forwarded-proto`/`x-forwarded-host` so the
 * values are right behind a CDN or ingress.
 */
export function publicOrigin(request: FastifyRequest): string {
  const configured = process.env.PUBLIC_SITE_ORIGIN;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fall through to the request-derived origin rather than emit a sitemap
      // full of `undefined/...` URLs.
    }
  }
  const forwardedProto = firstHeaderValue(request.headers["x-forwarded-proto"]);
  const forwardedHost = firstHeaderValue(request.headers["x-forwarded-host"]);
  const host = forwardedHost ?? request.headers.host ?? "localhost:4100";
  const protocol =
    forwardedProto ?? (request.protocol as string | undefined) ?? "http";
  return `${protocol}://${host}`;
}

/**
 * The body to forward upstream.
 *
 * GET/HEAD carry none. For everything else Fastify has already parsed the body
 * according to the inbound content type, so an object is re-serialized as JSON
 * and anything else (string, Buffer) is forwarded as-is — the first version
 * `JSON.stringify`d unconditionally, which corrupts a text or form body.
 */
function forwardBody(request: FastifyRequest): BodyInit | undefined {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const body = request.body;
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  // A Buffer is not a `BodyInit` under this lib config, but a plain
  // `ArrayBuffer` is. Slicing copies the exact bytes (no text re-encoding),
  // which is what a binary passthrough needs; request bodies through this route
  // are small enough that the copy is irrelevant.
  if (Buffer.isBuffer(body)) {
    return body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength,
    ) as ArrayBuffer;
  }
  return JSON.stringify(body);
}

function firstHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0]?.split(",")[0]?.trim();
  return value?.split(",")[0]?.trim();
}

/** Routes crawlers may index: static paths only (see {@link crawlableRoutes}). */
export function crawlableRoutes(): string[] {
  return (
    routeRegistry.routes
      // A `:param` route is a template, not a URL. Emitting `/product/:id` would
      // publish a 404 to crawlers, and enumerating real ids belongs to the owning
      // page app (which knows its catalog), not to the gateway.
      .filter((route) => !route.path.includes(":"))
      .map((route) => route.path)
      .sort()
  );
}

export function createRobotsTxt(origin: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    // Internal surfaces: useful to operators, meaningless to crawlers.
    "Disallow: /_shell/",
    "Disallow: /manifest/",
    "Disallow: /metrics",
    "Disallow: /health",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

export function createSitemapXml(origin: string): string {
  const urls = crawlableRoutes()
    .map(
      (path) => `  <url><loc>${new URL(path, origin).toString()}</loc></url>`,
    )
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}

/**
 * The named fragment's declared proxy targets, or null when the fragment is not
 * registered. Reads the fragment's `/manifest` at most once per version.
 *
 * Synchronous by design: the route handler needs the map to decide the upstream
 * URL, and a cache miss is filled by {@link primeFragmentProxyCache} on boot and
 * refreshed in the background, so a request never waits on a manifest fetch.
 */
function proxyTargetsFor(name: string): Record<string, string> | null {
  const resolved = resolveFragmentEntry(name);
  if (!resolved) return null;
  const cached = proxyManifestCache.get(name);
  if (cached && cached.version === resolved.version) return cached.proxy;
  // Unknown or stale: serve an empty map now (the target simply 404s) and
  // refresh for the next request rather than blocking this one.
  void refreshProxyManifest(name, resolved);
  return cached?.proxy ?? {};
}

/** Current stable-or-canary entry for a fragment. */
function resolveFragmentEntry(
  name: string,
): { version: string; serviceUrl: string; manifestUrl?: string } | null {
  const entry = fragmentRegistry.fragments[name];
  if (!entry) return null;
  return entry.stable ?? entry.canary ?? entry.preview ?? null;
}

async function refreshProxyManifest(
  name: string,
  resolved: { version: string; serviceUrl: string; manifestUrl?: string },
): Promise<void> {
  const url = resolved.manifestUrl ?? `${resolved.serviceUrl}/manifest`;
  const timeout = createUpstreamTimeout(DEFAULT_FRAGMENT_PROXY_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: timeout.signal });
    if (!response.ok) return;
    const manifest = (await response.json()) as { proxy?: unknown };
    const proxy =
      manifest.proxy && typeof manifest.proxy === "object"
        ? Object.fromEntries(
            Object.entries(manifest.proxy as Record<string, unknown>).filter(
              ([, value]) => typeof value === "string",
            ),
          )
        : {};
    proxyManifestCache.set(name, {
      version: resolved.version,
      proxy: proxy as Record<string, string>,
    });
  } catch {
    // A fragment that cannot serve its manifest simply has no proxy targets;
    // the route answers 404 and the next request retries.
  } finally {
    timeout.dispose();
  }
}

/**
 * Warms the proxy-manifest cache for every registered fragment. Called on boot
 * so the first browser request to a proxy target does not miss.
 */
export async function primeFragmentProxyCache(): Promise<void> {
  await Promise.all(
    Object.keys(fragmentRegistry.fragments).map(async (name) => {
      const resolved = resolveFragmentEntry(name);
      if (resolved) await refreshProxyManifest(name, resolved);
    }),
  );
}

function setRequestTrace(
  request: FastifyRequest,
  trace: RequestTrace,
  routeTemplate: string,
) {
  const state = requestState.get(request);
  if (state) {
    state.trace = trace;
    state.routeTemplate = routeTemplate;
  }
}

/**
 * Resolves which composed page a `/_next/*` asset request belongs to, using the
 * `Referer` (the page the browser is on) matched against the route registry.
 * Returns the page's origin (serviceUrl) or undefined when it can't be resolved.
 */
function pageOriginFromReferer(request: FastifyRequest): string | undefined {
  const referer = request.headers.referer;
  if (!referer) return undefined;
  let pathname: string;
  try {
    pathname = new URL(referer).pathname;
  } catch {
    return undefined;
  }
  return matchRoute(pathname)?.serviceUrl;
}

/** Reads a single query-string value from the request URL. */
function readQuery(request: FastifyRequest, key: string): string | undefined {
  const url = new URL(request.url, "http://shell.local");
  return url.searchParams.get(key) ?? undefined;
}

function normalizeTheme(
  value: string | undefined,
): ThemePreference | undefined {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : undefined;
}

function normalizeLocale(
  value: string | undefined,
): LocalePreference | undefined {
  return value === "en" || value === "zh" ? value : undefined;
}

/**
 * Resolves the safe return target for a preference switch: only same-origin
 * absolute paths are honored (open-redirect guard); anything else falls back to
 * `/`. `returnTo` is provided by the nav links.
 */
function safeReturnTo(request: FastifyRequest): string {
  const raw = readQuery(request, "returnTo");
  if (raw?.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/";
}

/** 302 back to the origin page while emitting the preference `Set-Cookie`. */
function redirectWithCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  setCookie: string,
) {
  reply.header("set-cookie", setCookie);
  reply.header("cache-control", "no-store");
  reply.redirect(safeReturnTo(request), 302);
  return reply;
}

function badPref(reply: FastifyReply, kind: string) {
  reply.code(400).type("text/plain");
  return `invalid ${kind} value`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  ensureTraceExportConfigured();
  const port = Number(process.env.PORT ?? 4100);
  const server = buildServer();
  // Best-effort: a fragment that is not up yet is retried on first use.
  void primeFragmentProxyCache();
  await server.listen({ host: "0.0.0.0", port });
  console.log(`shell-gateway listening on ${port}`);
}
