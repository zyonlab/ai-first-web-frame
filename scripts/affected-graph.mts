/**
 * affected:graph — graph-aware affected detection from a git diff
 * (docs/AI_NATIVE_DEVX.md §5). Maps changed files → seed units → the unit-graph
 * closure → the deployable images to rebuild + pages to runtime-verify.
 *
 * Usage:
 *   pnpm affected:graph [--base <ref>] [--head <ref>] [--json]
 *   pnpm affected:graph --base origin/main
 *
 * Base resolution: --base ref (if it exists) → origin/main → HEAD~1.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AffectedPlan,
  affectedFromChangedPaths,
  type RegistryFileReader,
} from "../tools/release-tools/src/affected-graph.ts";
import { loadUnitGraph } from "../tools/release-tools/src/load-graph.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function git(args: string[]): string {
  const proc = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return proc.status === 0 ? (proc.stdout ?? "").trim() : "";
}

function refExists(ref: string): boolean {
  return (
    spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: ROOT })
      .status === 0
  );
}

/** Resolves the base ref: explicit → origin/main → HEAD~1. */
export function resolveBase(explicit?: string): string {
  for (const ref of [explicit, "origin/main", "HEAD~1"]) {
    if (ref && refExists(ref)) return ref;
  }
  return "HEAD";
}

/** Changed paths from `base` (through `head` or the working tree). */
export function changedPaths(base: string, head?: string): string[] {
  const range = head ? `${base}..${head}` : base;
  const out = git(["diff", "--name-only", range]);
  return out ? out.split("\n").filter(Boolean) : [];
}

/** Content of `path` at `ref`, or `undefined` if it didn't exist there. */
function fileContentAt(ref: string, path: string): string | undefined {
  const proc = spawnSync("git", ["show", `${ref}:${path}`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return proc.status === 0 ? proc.stdout : undefined;
}

/** Current on-disk content of `path`, or `undefined` if it doesn't exist. */
function workingTreeContent(path: string): string | undefined {
  const abs = join(ROOT, path);
  return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
}

/**
 * Builds the §4.1 registry-diff content reader: "before" always comes from
 * the resolved diff base; "after" comes from `head` when diffing a fixed
 * range, otherwise from the working tree (matching how `changedPaths` picks
 * its diff target).
 */
function registryFileReader(base: string, head?: string): RegistryFileReader {
  return (path) => ({
    before: fileContentAt(base, path),
    after: head ? fileContentAt(head, path) : workingTreeContent(path),
  });
}

export async function computeAffectedPlan(
  base?: string,
  head?: string,
): Promise<AffectedPlan> {
  const graph = await loadUnitGraph(ROOT);
  const resolvedBase = resolveBase(base);
  const paths = changedPaths(resolvedBase, head);
  return affectedFromChangedPaths(graph, paths, {
    getRegistryFileContent: registryFileReader(resolvedBase, head),
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const base = argv[argv.indexOf("--base") + 1]?.startsWith("-")
    ? undefined
    : argv[argv.indexOf("--base") + 1];
  const head = argv[argv.indexOf("--head") + 1]?.startsWith("-")
    ? undefined
    : argv[argv.indexOf("--head") + 1];

  const plan = await computeAffectedPlan(
    argv.includes("--base") ? base : undefined,
    argv.includes("--head") ? head : undefined,
  );

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ status: "ok", ...plan }, null, 2)}\n`,
    );
    return;
  }
  console.log(
    plan.global
      ? "affected: GLOBAL (a shared package/platform/root change → rebuild all)"
      : `affected: ${plan.seeds.length} changed unit(s) → ${plan.deployables.length} deployable(s)`,
  );
  console.log(`  seeds:       ${plan.seeds.join(", ") || "—"}`);
  console.log(`  deployables: ${plan.deployables.join(", ") || "—"}`);
  console.log(`  runtime pages: ${plan.affectedPages.join(", ") || "—"}`);
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify({ status: "failed", error: String(error) })}\n`,
  );
  process.exitCode = 1;
});
