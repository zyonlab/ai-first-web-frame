/**
 * affected:graph — graph-aware affected detection from a git diff
 * (docs/AI_NATIVE_DEVX.md §5). Maps changed files → seed units → the unit-graph
 * closure → the deployable images to rebuild + pages to runtime-verify.
 *
 * Usage:
 *   pnpm affected:graph [--base <ref>] [--head <ref>] [--json]
 *   pnpm affected:graph --base origin/main
 *   pnpm affected:graph --base "$BASE" --github-output "$GITHUB_OUTPUT"
 *
 * Base resolution: --base ref (if it exists) → origin/main → HEAD~1.
 *
 * This is the single affected-detection engine (W1-A): `.github/workflows/ci.yml`
 * and `scripts/deploy-affected.mts` both consume it, so a given diff always
 * produces one answer. The `--github-output` flag mirrors the output contract
 * the CI docker-matrix job previously read from the old heuristic engine
 * (`scripts/affected.mts`, still present only because `packages/mcp/src/tools.ts`'s
 * `affected` MCP tool shells to it — see that engine's deprecation note).
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AffectedPlan,
  affectedFromChangedPaths,
  type RegistryFileReader,
  SHELL_UNIT,
} from "../tools/release-tools/src/affected-graph.ts";
import { loadUnitGraph } from "../tools/release-tools/src/load-graph.ts";
import type { UnitGraph } from "../tools/release-tools/src/unit-graph.ts";

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

/** Loads the graph once and computes the plan against it — shared by
 * `computeAffectedPlan` (back-compat for `deploy-affected.mts`) and the
 * `--github-output` matrix builder below, which needs the graph to resolve
 * each deployable id's `dir`/`dockerfile`. */
export async function computeAffectedPlanWithGraph(
  base?: string,
  head?: string,
): Promise<{ graph: UnitGraph; plan: AffectedPlan }> {
  const graph = await loadUnitGraph(ROOT);
  const resolvedBase = resolveBase(base);
  const paths = changedPaths(resolvedBase, head);
  const plan = affectedFromChangedPaths(graph, paths, {
    getRegistryFileContent: registryFileReader(resolvedBase, head),
  });
  return { graph, plan };
}

export async function computeAffectedPlan(
  base?: string,
  head?: string,
): Promise<AffectedPlan> {
  return (await computeAffectedPlanWithGraph(base, head)).plan;
}

/** Every deployable's Docker build context, matching the compose/CI convention
 * `fragments/<id>/Dockerfile`, `apps/<id>/Dockerfile` (shell-gateway included). */
function matrixEntry(
  graph: UnitGraph,
  id: string,
): { unit: string; dir: string; dockerfile: string } {
  const kind =
    id === SHELL_UNIT
      ? "page"
      : (graph.units.find((u) => u.id === id)?.kind ?? "component");
  const dir =
    kind === "page" || id === SHELL_UNIT ? `apps/${id}` : `fragments/${id}`;
  return { unit: id, dir, dockerfile: `${dir}/Dockerfile` };
}

/** GitHub Actions matrix payload for the docker build job — same shape as the
 * old engine's `toGithubMatrix` (`{ include: [{unit, dir, dockerfile}] }`). */
export function toGithubMatrix(
  graph: UnitGraph,
  plan: AffectedPlan,
): { include: Array<{ unit: string; dir: string; dockerfile: string }> } {
  return { include: plan.deployables.map((id) => matrixEntry(graph, id)) };
}

function writeGithubOutput(
  file: string,
  graph: UnitGraph,
  plan: AffectedPlan,
): void {
  const matrix = toGithubMatrix(graph, plan);
  const lines = [
    `has_units=${plan.deployables.length > 0 ? "true" : "false"}`,
    `units=${JSON.stringify(plan.deployables)}`,
    `matrix=${JSON.stringify(matrix)}`,
  ];
  appendFileSync(file, `${lines.join("\n")}\n`);
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
  const githubOutput = argv.includes("--github-output")
    ? argv[argv.indexOf("--github-output") + 1]
    : undefined;

  const { graph, plan } = await computeAffectedPlanWithGraph(
    argv.includes("--base") ? base : undefined,
    argv.includes("--head") ? head : undefined,
  );

  if (githubOutput) writeGithubOutput(githubOutput, graph, plan);

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
