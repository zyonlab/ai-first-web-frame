/**
 * dev:component — single-component dev harness (docs/AI_NATIVE_DEVX.md §4).
 *
 * Renders ONE fragment in isolation: its SSR (from the running fragment
 * service's demo route) inside the dark design-system theme, in a pane sized to
 * its `layoutHint`, alongside the contract-mocked world derived from its
 * manifest (which C3 slices to seed/inject, which C5 sources are mock-fed, which
 * slices it emits). No full stack.
 *
 * Usage:
 *   pnpm dev:component <name> [--port 4300] [--json]
 *   pnpm dev:component order-book
 *   pnpm dev:component order-form --json   # print the mock-world spec, no server
 */

import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAllThemeVariables,
  createTradeAliasVariables,
} from "../packages/design-system/src/index.ts";
import { renderHarnessPage } from "../tools/dev-harness/src/harness-page.ts";
import { describeMockWorld } from "../tools/dev-harness/src/mock-world.ts";
import {
  loadFragmentManifest,
  loadUnitGraph,
} from "../tools/release-tools/src/load-graph.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Fetches the fragment's SSR by POSTing its `/render` endpoint with sample props
 * (a symbol, which the trade fragments key off and others ignore). Returns the
 * rendered HTML (which already carries the fragment's inlined CSS).
 */
async function fetchFragmentHtml(
  serviceUrl: string | undefined,
): Promise<{ html: string; ok: boolean }> {
  if (!serviceUrl) return { html: "", ok: false };
  try {
    const res = await fetch(`${serviceUrl}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: { symbol: "BTC" } }),
    });
    const body = (await res.json()) as {
      html?: string;
      body?: { html?: string };
    };
    const html = body.html ?? body.body?.html ?? "";
    return { html, ok: html.length > 0 };
  } catch {
    return { html: "", ok: false };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const name = argv.find((a) => !a.startsWith("--"));
  const json = argv.includes("--json");
  const portArg = argv[argv.indexOf("--port") + 1];
  const port = Number(portArg) || 4300;

  if (!name) {
    process.stdout.write(
      `${JSON.stringify({ status: "failed", error: "usage: dev:component <name> [--port N] [--json]" })}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const manifest = await loadFragmentManifest(ROOT, name);
  if (!manifest) {
    process.stdout.write(
      `${JSON.stringify({ status: "failed", error: `no fragment "${name}"` })}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const world = describeMockWorld(manifest);

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ status: "ok", world }, null, 2)}\n`,
    );
    return;
  }

  const graph = await loadUnitGraph(ROOT);
  const serviceUrl = graph.units.find((u) => u.id === name)?.serviceUrl;
  const { html, ok } = await fetchFragmentHtml(serviceUrl);
  const fragmentHtml = ok
    ? html
    : `<section style="padding:16px;color:var(--mvp-color-text-muted)">Fragment service not reachable at <code>${serviceUrl ?? "unknown"}</code>.<br/>Start it (docker compose up ${name}) and refresh.</section>`;

  const themeCss = createAllThemeVariables() + createTradeAliasVariables();
  const page = renderHarnessPage({
    name,
    themeCss,
    fragmentHtml,
    world,
    serviceUrl,
  });

  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
  });
  server.listen(port, () => {
    console.log(`dev:component ${name} → http://localhost:${port}`);
    console.log(
      `  mock world: seed ${Object.keys(world.seededSlices).length} slice(s), mock ${world.mockDataSources.length} source(s), inject ${world.injectSlices.length}, observe ${world.observeSlices.length}`,
    );
    if (!ok)
      console.log(`  ⚠ fragment service ${serviceUrl ?? ""} not reachable`);
  });
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify({ status: "failed", error: String(error) })}\n`,
  );
  process.exitCode = 1;
});
