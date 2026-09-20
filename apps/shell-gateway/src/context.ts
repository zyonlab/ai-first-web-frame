import { continueTrace, formatTraceparent } from "@mvp/observability";
import {
  type LocalePreference,
  readThemePreference,
  resolveLocalePreference,
  type ThemePreference,
} from "@mvp/trade-prefs";
import type { FastifyRequest } from "fastify";
import { localeToLang } from "./chrome";

/** Cookie carrying the last-viewed trade symbol (06 §1.2 / §3.4). */
const LAST_SYMBOL_COOKIE = "mvp_last_symbol";

export type ShellRequestContext = {
  traceId: string;
  /** This request's own span, as W3C hex. Fresh per request, never inherited. */
  spanId: string;
  /** The caller's span, when this request continued an existing trace. */
  parentSpanId?: string;
  /** Ready-to-forward `traceparent` naming THIS process's span. */
  traceparent: string;
  requestId: string;
  /** BCP-47 tag forwarded to pages / emitted on `<html lang>` (e.g. `en-US`). */
  locale: string;
  /** Short locale (`en` | `zh`) resolved from cookie + Accept-Language (05 §3.2). */
  shellLocale: LocalePreference;
  /** Theme preference resolved from the `mvp_theme` cookie (05 §5.1). */
  theme: ThemePreference;
  /** Last-viewed symbol from cookie (drives the `Trade` deep link + indicator). */
  lastSymbol?: string;
  tenant: string;
  featureFlags: string[];
  userAgent: string;
  timestamp: string;
};

export function createShellRequestContext(
  request: FastifyRequest,
): ShellRequestContext {
  // W3C Trace Context is the contract; the bespoke `x-trace-id` stays supported
  // for callers that predate it.
  //
  // This used to call a function that returned a hardcoded constant, so every
  // request in the whole system shared one trace id — correlation looked
  // implemented and correlated nothing.
  //
  // A legacy `x-trace-id` still wins for `ctx.traceId`, because tests and
  // upstreams pin it. When it is also a valid 32-hex id the two headers name
  // the same trace; when it is not (`trace-home`), it simply cannot be carried
  // into `traceparent`, so the standard header names a freshly minted trace and
  // `x-trace-id` is echoed unchanged beside it.
  const incoming = getHeader(request, "x-trace-id");
  const traced = continueTrace(getHeader(request, "traceparent"));
  const traceId = incoming ?? traced.traceId;
  const w3cTraceId = /^[0-9a-f]{32}$/.test(traceId) ? traceId : traced.traceId;
  const traceparent = formatTraceparent({
    traceId: w3cTraceId,
    spanId: traced.spanId,
    sampled: traced.sampled,
  });
  const cookieHeader = request.headers.cookie ?? "";
  const acceptLanguage = getHeader(request, "accept-language");

  // Theme + locale are shell-owned (README §14 D5): resolve them here so both
  // the SSR chrome and the downstream page render the same values.
  const theme = readThemePreference(cookieHeader);
  const shellLocale = resolveLocalePreference({ cookieHeader, acceptLanguage });
  // An explicit `x-locale` header (test / upstream) still wins for the forwarded
  // BCP-47 value; otherwise it derives from the resolved short locale.
  const locale = getHeader(request, "x-locale") ?? localeToLang(shellLocale);

  return Object.freeze({
    traceId,
    spanId: traced.spanId,
    ...(traced.parentSpanId ? { parentSpanId: traced.parentSpanId } : {}),
    traceparent,
    requestId: getHeader(request, "x-request-id") ?? traceId,
    locale,
    shellLocale,
    theme,
    lastSymbol: readLastSymbol(cookieHeader),
    tenant: getHeader(request, "x-tenant") ?? "public",
    featureFlags: parseFlags(getHeader(request, "x-flags")),
    userAgent: request.headers["user-agent"]?.toString() ?? "",
    timestamp: new Date(0).toISOString(),
  });
}

function readLastSymbol(cookieHeader: string): string | undefined {
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LAST_SYMBOL_COOKIE}=`));
  if (!match) return undefined;
  const raw = decodeURIComponent(match.slice(LAST_SYMBOL_COOKIE.length + 1));
  const upper = raw.trim().toUpperCase();
  return /^[A-Z0-9]{1,10}$/.test(upper) ? upper : undefined;
}

export function createFragmentHeaders(ctx: ShellRequestContext) {
  return {
    traceparent: ctx.traceparent,
    "x-trace-id": ctx.traceId,
    "x-request-id": ctx.requestId,
    "x-locale": ctx.locale,
    "x-theme": ctx.theme,
    "x-tenant": ctx.tenant,
    "x-flags": ctx.featureFlags.join(","),
  };
}

function getHeader(request: FastifyRequest, name: string) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value?.toString();
}

function parseFlags(value: string | undefined) {
  return value
    ? value
        .split(",")
        .map((flag) => flag.trim())
        .filter(Boolean)
    : [];
}
