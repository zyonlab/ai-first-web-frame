import { pathToFileURL } from "node:url";
import {
  createRequestTrace,
  exportTrace as defaultExportTrace,
  type RequestTrace,
} from "@mvp/observability";
import {
  type LocalePreference,
  type ThemePreference,
  writeLocalePreference,
  writeThemePreference,
} from "@mvp/storage";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { fragmentRegistry } from "../../../platform/fragment-registry/src/registry";
import {
  matchRoute,
  routeRegistry,
} from "../../../platform/route-registry/src/registry";
import { wrapShellChrome } from "./chrome";
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

export type BuildServerOptions = {
  /** Monotonic clock in milliseconds, injected for deterministic tests. */
  now?: () => number;
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
    try {
      const response = await fetch(`${route.serviceUrl}${pathname}`, {
        headers: createFragmentHeaders(ctx),
      });

      if (!response.ok)
        throw new Error(`page ${route.page} returned ${response.status}`);

      trace.endSpan(upstreamSpan, {
        status: "ok",
        attributes: { statusCode: response.status },
      });
      trace.endSpan(requestSpan, { status: "ok" });

      reply
        .code(response.status)
        .type(response.headers.get("content-type") ?? "text/html");
      const body = await response.text();
      const state = requestState.get(request);
      return wrapShellChrome({
        html: body,
        pathname,
        page: route.page,
        theme: ctx.theme,
        locale: ctx.shellLocale,
        lastSymbol: ctx.lastSymbol,
        nonce: state?.nonce,
      });
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
    }
  });

  return server;
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
  await server.listen({ host: "0.0.0.0", port });
  console.log(`shell-gateway listening on ${port}`);
}
