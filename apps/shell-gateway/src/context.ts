import type { FastifyRequest } from "fastify";

export type ShellRequestContext = {
  traceId: string;
  requestId: string;
  locale: string;
  tenant: string;
  featureFlags: string[];
  userAgent: string;
  timestamp: string;
};

export function createShellRequestContext(
  request: FastifyRequest,
): ShellRequestContext {
  const traceId = getHeader(request, "x-trace-id") ?? createTraceId();
  return Object.freeze({
    traceId,
    requestId: getHeader(request, "x-request-id") ?? traceId,
    locale: getHeader(request, "x-locale") ?? "en-US",
    tenant: getHeader(request, "x-tenant") ?? "public",
    featureFlags: parseFlags(getHeader(request, "x-flags")),
    userAgent: request.headers["user-agent"]?.toString() ?? "",
    timestamp: new Date(0).toISOString(),
  });
}

export function createFragmentHeaders(ctx: ShellRequestContext) {
  return {
    "x-trace-id": ctx.traceId,
    "x-request-id": ctx.requestId,
    "x-locale": ctx.locale,
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
