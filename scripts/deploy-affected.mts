/**
 * deploy:affected — rebuild + recreate only the docker images affected by a git
 * diff, computed from the unit graph (docs/AI_NATIVE_DEVX.md §5). Optionally runs
 * the `verify:runtime` gate against the affected pages afterwards.
 *
 * Usage:
 *   pnpm deploy:affected [--base <ref>] [--dry-run] [--runtime]
 *
 * Builds sequentially (memory-safe) and only recreates what it built.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeAffectedPlan } from "./affected-graph.mts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE = "infra/docker/docker-compose.yml";

/** A representative composed URL for a page (shell origin + its route). */
const PAGE_URL: Record<string, string> = {
  "page-trade": "http://localhost:4100/trade/BTC",
  "page-home": "http://localhost:4100/",
  "page-product": "http://localhost:4100/product/1",
  "page-markets": "http://localhost:4100/markets",
  "page-portfolio": "http://localhost:4100/portfolio",
  "page-vaults": "http://localhost:4100/vaults",
  "page-referrals": "http://localhost:4100/referrals",
};

function run(cmd: string, args: string[]): number {
  return spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" }).status ?? 1;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const runtime = argv.includes("--runtime");
  const base = argv.includes("--base")
    ? argv[argv.indexOf("--base") + 1]
    : undefined;

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
    if (runtime)
      console.log(
        "(dry run) would verify:runtime:",
        plan.affectedPages.join(", ") || "—",
      );
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
      const url = PAGE_URL[page];
      if (!url) {
        console.log(`\n(skip runtime: no URL mapping for ${page})`);
        continue;
      }
      console.log(`\n=== verify:runtime ${page} (${url}) ===`);
      if (
        run("pnpm", [
          "exec",
          "tsx",
          "scripts/verify-runtime.mts",
          "--url",
          url,
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
