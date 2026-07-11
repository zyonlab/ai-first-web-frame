/**
 * @deprecated (W1-A, docs/REMEDIATION_PLAN.md) Superseded by
 * `scripts/affected-graph.mts` (the graph engine), which both
 * `.github/workflows/ci.yml` and `scripts/deploy-affected.mts` now use — see
 * `tools/release-tools/src/affected.ts`'s module doc for why this file is
 * kept rather than deleted (`packages/mcp/src/tools.ts`'s `affected` tool
 * still calls it). Do not add features here; add them to the graph engine.
 *
 * Affected deployable-unit detection CLI.
 *
 * Computes which of the five deployable units (shell-gateway, page-home,
 * page-product, promotion-banner, recommendation-widget) need a Docker image
 * rebuild for a given git diff. Core logic lives in
 * tools/release-tools/src/affected.ts and is unit tested there; this file
 * only handles git, filesystem, and output formatting.
 *
 * Usage:
 *   pnpm exec tsx scripts/affected.mts [--base <ref>] [--head <ref>]
 *     [--list] [--github-output <file>]
 *
 * Base resolution order: --base ref (if valid) -> origin/main -> HEAD~1.
 * When no valid base exists (fresh clone, force push), all units are
 * reported as affected with reason "no-valid-base".
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AffectedResult,
  computeAffected,
  DEPLOYABLE_UNITS,
  parseWorkspacePackage,
  toGithubMatrix,
  type WorkspacePackage,
} from "../tools/release-tools/src/affected.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const HELP = `Usage: pnpm exec tsx scripts/affected.mts [options]

Options:
  --base <ref>            Base git ref to diff against (default: origin/main, then HEAD~1)
  --head <ref>            Head git ref (default: HEAD)
  --list                  Print affected unit names one per line instead of JSON
  --github-output <file>  Append units/matrix/has_units outputs for GitHub Actions
  --help                  Show this help
`;

type CliArgs = {
  base?: string;
  head: string;
  list: boolean;
  githubOutput?: string;
};

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { head: "HEAD", list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (arg === "--base") {
      args.base = argv[++index];
    } else if (arg.startsWith("--base=")) {
      args.base = arg.slice("--base=".length);
    } else if (arg === "--head") {
      args.head = argv[++index] ?? "HEAD";
    } else if (arg.startsWith("--head=")) {
      args.head = arg.slice("--head=".length);
    } else if (arg === "--list") {
      args.list = true;
    } else if (arg === "--github-output") {
      args.githubOutput = argv[++index];
    } else if (arg.startsWith("--github-output=")) {
      args.githubOutput = arg.slice("--github-output=".length);
    } else {
      process.stderr.write(`Unknown argument: ${arg}\n\n${HELP}`);
      process.exit(2);
    }
  }
  return args;
}

function git(args: string[]): { status: number; stdout: string } {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

function isValidRef(ref: string | undefined): ref is string {
  if (!ref) return false;
  // github.event.before is all zeros for force pushes and new branches.
  if (/^0+$/.test(ref)) return false;
  return (
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status === 0
  );
}

function resolveBase(requested: string | undefined): string | undefined {
  for (const candidate of [requested, "origin/main", "HEAD~1"]) {
    if (isValidRef(candidate)) return candidate;
  }
  return undefined;
}

function changedFiles(base: string, head: string): string[] {
  // Three-dot diff matches PR semantics (changes since merge-base).
  const threeDot = git(["diff", "--name-only", `${base}...${head}`]);
  const output =
    threeDot.status === 0
      ? threeDot.stdout
      : git(["diff", "--name-only", base, head]).stdout;
  return output.split("\n").filter((line) => line.trim().length > 0);
}

function loadWorkspacePackages(): WorkspacePackage[] {
  const groups = ["apps", "fragments", "packages", "tools"];
  const packages: WorkspacePackage[] = [];
  for (const group of groups) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageJsonPath = join(groupDir, entry.name, "package.json");
      if (!existsSync(packageJsonPath)) continue;
      const parsed = parseWorkspacePackage(
        `${group}/${entry.name}`,
        JSON.parse(readFileSync(packageJsonPath, "utf8")),
      );
      if (parsed) packages.push(parsed);
    }
  }
  return packages;
}

function allUnitsResult(reason: string): AffectedResult {
  return {
    changedFiles: [],
    changedPackages: [],
    units: DEPLOYABLE_UNITS.map((unit) => ({
      unit: unit.unit,
      packageName: unit.packageName,
      dir: unit.dir,
      dockerfile: unit.dockerfile,
      reasons: [reason],
    })),
    matchedAll: true,
  };
}

function writeGithubOutput(file: string, result: AffectedResult): void {
  const matrix = toGithubMatrix(result);
  const lines = [
    `has_units=${result.units.length > 0 ? "true" : "false"}`,
    `units=${JSON.stringify(result.units.map((unit) => unit.unit))}`,
    `matrix=${JSON.stringify(matrix)}`,
  ];
  appendFileSync(file, `${lines.join("\n")}\n`);
}

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  const base = resolveBase(args.base);

  let result: AffectedResult;
  let baseLabel: string;
  if (!base) {
    baseLabel = "none";
    result = allUnitsResult("no-valid-base");
  } else {
    baseLabel = base;
    result = computeAffected(
      changedFiles(base, args.head),
      loadWorkspacePackages(),
      DEPLOYABLE_UNITS,
    );
  }

  if (args.githubOutput) writeGithubOutput(args.githubOutput, result);

  if (args.list) {
    process.stdout.write(
      result.units.map((unit) => unit.unit).join("\n") +
        (result.units.length > 0 ? "\n" : ""),
    );
    return;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        base: baseLabel,
        head: args.head,
        changedFiles: result.changedFiles,
        changedPackages: result.changedPackages,
        matchedAll: result.matchedAll,
        units: result.units,
      },
      null,
      2,
    )}\n`,
  );
}

main();
