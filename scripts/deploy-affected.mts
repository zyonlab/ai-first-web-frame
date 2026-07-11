/**
 * deploy:affected — rebuild + recreate only the docker images affected by a git
 * diff, computed from the unit graph (docs/AI_NATIVE_DEVX.md §5). Optionally runs
 * the `verify:runtime` gate against the affected pages afterwards.
 *
 * Usage:
 *   pnpm deploy:affected [--base <ref>] [--dry-run] [--runtime] [--origin <url>]
 *
 * `--origin` is the shell-gateway origin the runtime gate composes through
 * (default `http://localhost:4100`, or `$SHELL_URL`); each affected page's
 * path is resolved from its own `apps/<page>/src/manifest.ts` `route` field
 * (see `resolvePageUrl` below) rather than a hand-kept page→URL table, so a
 * new composed page needs no edit here to be runtime-verifiable.
 *
 * Builds sequentially (memory-safe) and only recreates what it built.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeAffectedPlan } from "./affected-graph.mts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE = "infra/docker/docker-compose.yml";
const DEFAULT_ORIGIN = "http://localhost:4100";

/**
 * Sample values for dynamic route segments (e.g. `page-trade`'s
 * `/trade/:symbol`). A route param has no runtime-derivable value, so this is
 * the one piece of page-specific knowledge this script still hand-keeps —
 * centralized ONCE, next to the resolver, instead of a full page→URL map.
 * Matches the pre-existing default target (`/trade/BTC`).
 */
const ROUTE_PARAM_SAMPLES: Record<string, string> = {
  symbol: "BTC",
  id: "1",
};

function run(cmd: string, args: string[]): number {
  return spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" }).status ?? 1;
}

/** Reads `apps/<page>/src/manifest.ts`'s `route` field by dynamic import
 * (same direct-path-import approach `tools/release-tools/src/load-graph.ts`
 * uses for fragment/route manifests) — no page-specific hand-kept map. */
async function loadPageRoute(page: string): Promise<string | undefined> {
  const manifestPath = join(ROOT, "apps", page, "src", "manifest.ts");
  if (!existsSync(manifestPath)) return undefined;
  const mod = (await import(pathToFileURL(manifestPath).href)) as Record<
    string,
    unknown
  >;
  const manifest = Object.values(mod).find(
    (v): v is { route: string } =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as { route?: unknown }).route === "string",
  );
  return manifest?.route;
}

/** Fills `:param` segments from `ROUTE_PARAM_SAMPLES`; reports the first
 * segment with no known sample instead of silently leaving it unfilled. */
function fillRouteParams(route: string): { path?: string; error?: string } {
  let missing: string | undefined;
  const filled = route.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
    const sample = ROUTE_PARAM_SAMPLES[name];
    if (sample === undefined) {
      missing ??= name;
      return `:${name}`;
    }
    return sample;
  });
  return missing
    ? { error: `no sample value for route param ":${missing}"` }
    : { path: filled };
}

/**
 * Resolves the composed URL to runtime-verify for `page`: its manifest's
 * `route`, with dynamic segments filled, appended to `origin`. Never skips —
 * an affected page with no derivable URL is a failure (`error` set), not a
 * silent omission, so a new/misconfigured page can't slip past the gate.
 */
export async function resolvePageUrl(
  page: string,
  origin: string,
): Promise<{ url?: string; error?: string }> {
  const route = await loadPageRoute(page);
  if (!route) {
    return {
      error: `no derivable route for page "${page}" (apps/${page}/src/manifest.ts is missing, unreadable, or has no "route" field)`,
    };
  }
  const { path, error } = fillRouteParams(route);
  if (error || path === undefined) {
    return { error: `${error} in route "${route}" for page "${page}"` };
  }
  return { url: `${origin}${path}` };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const runtime = argv.includes("--runtime");
  const base = argv.includes("--base")
    ? argv[argv.indexOf("--base") + 1]
    : undefined;
  const origin = argv.includes("--origin")
    ? argv[argv.indexOf("--origin") + 1]
    : (process.env.SHELL_URL ?? DEFAULT_ORIGIN);

  const plan = await computeAffectedPlan(base);
  const services = plan.deployables;

  console.log(
    plan.global
      ? "deploy:affected — GLOBAL rebuild (shared change)"
      : `deploy:affected — ${services.length} image(s): ${services.join(", ") || "none"}`,
  );
  if (services.length === 0) {
    console.log("nothing to deploy.");
    return;
  }
  if (dryRun) {
    console.log("(dry run) would build + recreate:", services.join(", "));
    if (runtime) {
      console.log("(dry run) would verify:runtime:");
      for (const page of plan.affectedPages) {
        const resolved = await resolvePageUrl(page, origin);
        console.log(
          resolved.url
            ? `  ${page} -> ${resolved.url}`
            : `  ${page} -> FAIL: ${resolved.error}`,
        );
      }
    }
    return;
  }

  // Build sequentially to stay memory-safe, then recreate what we built.
  for (const svc of services) {
    console.log(`\n=== build ${svc} ===`);
    if (run("docker", ["compose", "-f", COMPOSE, "build", svc]) !== 0) {
      console.error(`build failed: ${svc}`);
      process.exitCode = 1;
      return;
    }
  }
  console.log("\n=== recreate ===");
  run("docker", ["compose", "-f", COMPOSE, "up", "-d", ...services]);

  if (runtime) {
    for (const page of plan.affectedPages) {
      const resolved = await resolvePageUrl(page, origin);
      if (!resolved.url) {
        // No derivable URL is a failure, not a skip: an affected page must
        // never silently drop out of the runtime gate.
        console.error(
          `\n=== verify:runtime ${page}: FAILED — ${resolved.error} ===`,
        );
        process.exitCode = 1;
        continue;
      }
      console.log(`\n=== verify:runtime ${page} (${resolved.url}) ===`);
      if (
        run("pnpm", [
          "exec",
          "tsx",
          "scripts/verify-runtime.mts",
          "--url",
          resolved.url,
        ]) !== 0
      ) {
        process.exitCode = 1;
      }
    }
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
