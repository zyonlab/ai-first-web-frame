import { type RequestContext, RequestContextSchema } from "@mvp/contracts";

type HeaderBag = Record<string, string | string[] | undefined> | Headers;
type ReqLike = {
  headers?: HeaderBag;
  ip?: string;
  socket?: { remoteAddress?: string };
};

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
    timestamp: new Date().toISOString(),
  });
  return deepFreeze(ctx);
}

export const getLocale = (ctx: RequestContext) => ctx.locale;
export const getTenant = (ctx: RequestContext) => ctx.tenant;
export const getUser = (ctx: RequestContext) => ctx.user;
export const getFeatureFlags = (ctx: RequestContext) => ctx.featureFlags;
export const getTraceId = (ctx: RequestContext) => ctx.traceId;

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
  };
}

export function deserializeContext(
  headersOrObject: HeaderBag | Record<string, unknown>,
): Readonly<RequestContext> {
  return createRequestContext({ headers: headersOrObject as HeaderBag });
}
