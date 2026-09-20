import { type RequestContext, RequestContextSchema } from "@mvp/contracts";

type HeaderBag = Record<string, string | string[] | undefined> | Headers;

/**
 * Reads one custom context dimension off the inbound request. Returning
 * `undefined` omits the dimension entirely (it never appears as an empty
 * string in `ctx.extensions`).
 */
export type ContextParser = (
  read: (name: string) => string | undefined,
) => string | undefined;

type ReqLike = {
  headers?: HeaderBag;
  ip?: string;
  socket?: { remoteAddress?: string };
  /**
   * Custom context dimensions, keyed by name. The framework stays ignorant of
   * what they mean: each parser gets a header reader and returns a string.
   * Parsed values land in `ctx.extensions` and are propagated to fragments as
   * `x-mvp-ctx-<name>` headers, so a fragment's own `createRequestContext`
   * recovers them without any framework change.
   */
  extensions?: Record<string, ContextParser>;
};

/** Header prefix carrying `ctx.extensions` across the page → fragment hop. */
export const CONTEXT_EXTENSION_HEADER_PREFIX = "x-mvp-ctx-";

/** Custom dimensions already present on the inbound request headers. */
function readInboundExtensions(
  headers: HeaderBag | undefined,
): Record<string, string> {
  const found: Record<string, string> = {};
  if (!headers) return found;
  const entries: Array<[string, string]> =
    headers instanceof Headers
      ? [...headers.entries()]
      : Object.entries(headers).flatMap(([key, value]) => {
          const first = Array.isArray(value) ? value[0] : value;
          return first === undefined
            ? []
            : ([[key, first]] as Array<[string, string]>);
        });
  for (const [key, value] of entries) {
    const lower = key.toLowerCase();
    if (!lower.startsWith(CONTEXT_EXTENSION_HEADER_PREFIX)) continue;
    const name = lower.slice(CONTEXT_EXTENSION_HEADER_PREFIX.length);
    if (name) found[name] = value;
  }
  return found;
}

function readHeader(
  headers: HeaderBag | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const direct = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(direct) ? direct[0] : direct;
}

function parseFlags(
  raw: string | undefined,
): Record<string, boolean | string | number> {
  if (!raw) return {};
  return Object.fromEntries(
    raw
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [key, value = "true"] = pair.split("=");
        if (value === "true") return [key, true];
        if (value === "false") return [key, false];
        const numberValue = Number(value);
        return [key, Number.isFinite(numberValue) ? numberValue : value];
      }),
  );
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreeze(nested);
  }
  return value as Readonly<T>;
}

export function createRequestContext(
  reqLike: ReqLike = {},
): Readonly<RequestContext> {
  const headers = reqLike.headers;
  const ctx = RequestContextSchema.parse({
    traceId: readHeader(headers, "x-trace-id") ?? makeId("trace"),
    requestId: readHeader(headers, "x-request-id") ?? makeId("req"),
    locale: readHeader(headers, "x-locale") ?? "en-US",
    tenant: readHeader(headers, "x-tenant") ?? "default",
    user: readHeader(headers, "x-user-id")
      ? {
          id: readHeader(headers, "x-user-id") ?? "anonymous",
          role: readHeader(headers, "x-user-role"),
        }
      : undefined,
    session: readHeader(headers, "x-session-id")
      ? { id: readHeader(headers, "x-session-id") ?? "" }
      : undefined,
    featureFlags: parseFlags(readHeader(headers, "x-flags")),
    experiment: {},
    theme:
      (readHeader(headers, "x-theme") as RequestContext["theme"] | undefined) ??
      "system",
    device:
      (readHeader(headers, "x-device") as
        | RequestContext["device"]
        | undefined) ?? "unknown",
    userAgent: readHeader(headers, "user-agent") ?? "",
    ip:
      readHeader(headers, "x-forwarded-for") ??
      reqLike.ip ??
      reqLike.socket?.remoteAddress,
    // Inbound `x-mvp-ctx-*` headers come first (an upstream edge already
    // resolved them); locally declared parsers then override, so the edge
    // closest to the request wins.
    extensions: {
      ...readInboundExtensions(headers),
      ...Object.fromEntries(
        Object.entries(reqLike.extensions ?? {}).flatMap(([name, parse]) => {
          const value = parse((header) => readHeader(headers, header));
          return value === undefined ? [] : [[name.toLowerCase(), value]];
        }),
      ),
    },
    timestamp: new Date().toISOString(),
  });
  return deepFreeze(ctx);
}

export const getLocale = (ctx: RequestContext) => ctx.locale;
export const getTenant = (ctx: RequestContext) => ctx.tenant;
export const getUser = (ctx: RequestContext) => ctx.user;
export const getFeatureFlags = (ctx: RequestContext) => ctx.featureFlags;
export const getTraceId = (ctx: RequestContext) => ctx.traceId;
/** One custom context dimension, or undefined when it was not resolved. */
export const getContextExtension = (ctx: RequestContext, name: string) =>
  ctx.extensions[name.toLowerCase()];

export function serializeContext(ctx: RequestContext): Record<string, string> {
  return {
    "x-trace-id": ctx.traceId,
    "x-request-id": ctx.requestId,
    "x-locale": ctx.locale,
    "x-tenant": ctx.tenant,
    "x-flags": Object.entries(ctx.featureFlags)
      .map(([key, value]) => `${key}=${value}`)
      .join(","),
    "x-theme": ctx.theme,
    "x-device": ctx.device,
    // One header per custom dimension rather than one packed header: a
    // fragment (or a proxy hop) can read a single dimension without parsing,
    // and an unknown dimension is simply ignored.
    // `?? {}` on purpose: this is the hot page→fragment path, and a context
    // object built by an older version of this package (or by hand in a test
    // fixture) must not crash serialization over a field it never had.
    ...Object.fromEntries(
      Object.entries(ctx.extensions ?? {}).map(([name, value]) => [
        `${CONTEXT_EXTENSION_HEADER_PREFIX}${name}`,
        value,
      ]),
    ),
  };
}

export function deserializeContext(
  headersOrObject: HeaderBag | Record<string, unknown>,
): Readonly<RequestContext> {
  return createRequestContext({ headers: headersOrObject as HeaderBag });
}
