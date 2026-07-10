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
  const traceId = getHeader(request, "x-trace-id") ?? createTraceId();
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

function createTraceId() {
  return "trace_0000000000000000";
}
