import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import { fragmentRegistry } from "../../../platform/fragment-registry/src/registry";
import {
  matchRoute,
  routeRegistry,
} from "../../../platform/route-registry/src/registry";
import { createFragmentHeaders, createShellRequestContext } from "./context";
import { createNotFoundFallback, createShellFallback } from "./fallback";

export function buildServer() {
  const server = Fastify({ logger: false });

  server.addHook("onRequest", async (_request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
    reply.header("x-shell-cache", "route-registry");
  });

  server.get("/health", async () => ({
    status: "ok",
    service: "shell-gateway",
  }));
  server.get("/manifest/routes", async () => routeRegistry);
  server.get("/manifest/fragments", async () => fragmentRegistry);

  server.get("/*", async (request, reply) => {
    const ctx = createShellRequestContext(request);
    reply.header("x-trace-id", ctx.traceId);
    reply.header("server-timing", "shell;dur=1");

    const pathname = new URL(request.url, "http://shell.local").pathname;
    const route = matchRoute(pathname);
    if (!route) {
      reply.code(404).type("text/html");
      return createNotFoundFallback(pathname);
    }

    try {
      const response = await fetch(`${route.serviceUrl}${pathname}`, {
        headers: createFragmentHeaders(ctx),
      });

      if (!response.ok)
        throw new Error(`page ${route.page} returned ${response.status}`);

      reply
        .code(response.status)
        .type(response.headers.get("content-type") ?? "text/html");
      const body = await response.text();
      return decorateShellHtml(body, pathname, route.page);
    } catch (error) {
      reply.code(502).type("text/html");
      return createShellFallback(
        pathname,
        ctx.traceId,
        error instanceof Error ? error.message : "page proxy failed",
      );
    }
  });

  return server;
}

function decorateShellHtml(html: string, pathname: string, page: string) {
  if (!html.includes("<body")) return html;
  const marker = `<div data-shell-gateway="true" style="font-family:system-ui,sans-serif;background:#111;color:#fff;padding:8px 14px;font-size:13px">Shell gateway route: <strong>${escapeHtml(pathname)}</strong> -> ${escapeHtml(page)}</div>`;
  return html.replace(/<body([^>]*)>/, `<body$1>${marker}`);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT ?? 4100);
  const server = buildServer();
  await server.listen({ host: "0.0.0.0", port });
  console.log(`shell-gateway listening on ${port}`);
}
