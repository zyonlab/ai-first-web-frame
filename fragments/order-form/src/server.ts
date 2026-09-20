/**
 * order-form SSR fragment service.
 *
 * Every HTTP behavior — `GET /` demo page, `/health`, `/ready`, `/metrics`,
 * `/manifest`, `/assets`, `/budget`, `POST /render` envelope validation,
 * request metrics and trace export — lives in `@mvp/fragment-host`. This file
 * is only the adapter that names this fragment and hands the host its
 * manifest, budget, render function and demo request, so a change to the
 * fragment HTTP contract is one edit in the host instead of fourteen here.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BuildFragmentServerOptions,
  createFragmentServer,
  isProcessEntry,
  startFragmentServer,
} from "@mvp/fragment-host";
import { createRequestContext } from "@mvp/request-context";
import type { FastifyInstance } from "fastify";
import { orderFormBudget } from "./budget";
import { loadAccountMargin } from "./data";
import { orderFormManifest } from "./manifest";
import { renderOrderForm } from "./render";

export const SERVICE_NAME = "order-form";
const DEFAULT_PORT = 4205;

/**
 * Real, browser-loadable island module (C3 spike, §4.3.3 "Runtime island
 * assets") — the tsdown browser build of `island.browser.ts`
 * (`pnpm run build:island-browser`; a MANUAL script since the C3 no-go
 * decision unchained it from this package's `build`, so the route answers a
 * structured 404 until it is run). Resolved relative to THIS file so it works
 * whether the server runs from `src/server.ts` (tsx, dev) or the built
 * `dist/server.js` (node, prod) — both sit next to `dist-browser/`.
 */
const ISLAND_BROWSER_BUNDLE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist-browser",
  "island.browser.js",
);

/**
 * Serves the island bundle at a real, fetchable URL. Unversioned path — fine
 * for the spike's single canary deployment, but NOT immutable/cacheable the
 * way a real rollout needs (§4.3.3: a real asset URL needs a content hash or
 * version segment).
 */
/**
 * Browser-reachable account read, mounted by the gateway at
 * `/_fragment/order-form/account` (see `manifest.proxy`). This is what the
 * hydrated island calls to refresh margin — the SSR path uses the same
 * `loadAccountMargin`, so one implementation serves both.
 */
function mountAccountRoute(server: FastifyInstance): void {
  server.get("/account", async (request, reply) => {
    // The gateway forwards the full request context, so this read is as
    // tenant/locale-aware as the /render path.
    const ctx = createRequestContext({ headers: request.headers });
    const account = await loadAccountMargin(ctx, new Map());
    // Per-user margin: never cacheable.
    reply.header("cache-control", "no-store");
    return account;
  });
}

function mountIslandBundleRoute(server: FastifyInstance): void {
  server.get("/assets/order-form.island.js", async (_request, reply) => {
    try {
      const bundle = await readFile(ISLAND_BROWSER_BUNDLE_PATH, "utf8");
      reply.type("text/javascript; charset=utf-8");
      // Unversioned path — fine for the spike's single canary deployment,
      // but NOT immutable/cacheable the way a real rollout needs (§4.3.3
      // findings: a real asset URL needs a content hash or version segment
      // so it's safe to cache aggressively).
      reply.header("Cache-Control", "no-store");
      // Real spike finding: a page (apps/page-trade, a different origin —
      // localhost:4103 vs this fragment's localhost:4205) dynamically
      // `import()`ing this module is a CROSS-ORIGIN module fetch, which the
      // ES module spec always fetches in CORS mode. Without this header a
      // real browser blocks the import outright (opaque response) — this
      // was only caught by actually loading the page in a browser and
      // reading the console, not by curl or a unit test. `*` is fine for a
      // publicly-cacheable, non-credentialed static asset; a real rollout
      // should scope this to known consuming page origins.
      reply.header("Access-Control-Allow-Origin", "*");
      return bundle;
    } catch {
      reply.code(404);
      return {
        error: {
          code: "island-bundle-not-built",
          message:
            "dist-browser/island.browser.js is missing — run `pnpm --filter @mvp/fragment-order-form run build:island-browser` (or `build`) first.",
        },
      };
    }
  });
}

export function buildServer(options: BuildFragmentServerOptions = {}) {
  return createFragmentServer({
    serviceName: SERVICE_NAME,
    port: DEFAULT_PORT,
    manifest: orderFormManifest,
    budget: orderFormBudget,
    render: renderOrderForm,
    demo: { ctx: { locale: "en-US" }, props: { symbol: "BTC" } },
    extraRoutes: (instance) => {
      mountAccountRoute(instance);
      mountIslandBundleRoute(instance);
    },
    ...options,
  });
}

if (isProcessEntry(import.meta.url)) {
  await startFragmentServer(buildServer(), {
    serviceName: SERVICE_NAME,
    port: DEFAULT_PORT,
  });
}
