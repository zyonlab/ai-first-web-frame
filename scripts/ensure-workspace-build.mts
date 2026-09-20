/**
 * ensure-workspace-build — make `dist/` exist before gates that need it.
 *
 * `packages/*` and `domains/*` publish through `package.json#exports`, which
 * point at `dist/`. Any gate that resolves a workspace package as a REAL module
 * (a `tsx` subprocess, or an in-process test that shells out to one) therefore
 * needs those builds — vitest's `src/` aliases do not help there.
 *
 * On a fresh clone that produced a confusing failure rather than a useful one:
 * `pnpm test` went red inside `packages/mcp` with
 * `SyntaxError: Unexpected token 'o', "node:intern"...` (the child process's
 * ERR_MODULE_NOT_FOUND stack being JSON.parsed), and `pnpm verify:manifest-gen`
 * failed outright. `pnpm verify` never showed it because it prebuilds
 * unconditionally — so the fix was present in the umbrella command and missing
 * from every gate underneath it.
 *
 * It is still needed after the move to turbo, and the reason is worth stating:
 * turbo's `dependsOn: ["^build"]` only covers DECLARED workspace dependencies.
 * `@mvp/mcp` declares none, yet its tests shell out to `scripts/*.mts`, which
 * import `@mvp/registry` / `@mvp/contracts` / domains at runtime. That edge is
 * invisible to the task graph, so the framework layer is built up front — a
 * ~40ms full cache hit on a warm tree.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const GROUPS = ["packages", "domains"];

export type MissingBuild = { packageName: string; entry: string };

/** Entry files a built package must have, taken from its own package.json. */
function entryFilesFor(packageDir: string): string[] {
  const manifestPath = join(packageDir, "package.json");
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    scripts?: Record<string, string>;
    main?: string;
    exports?: Record<string, unknown>;
  };
  // Only packages that actually build can be missing a build.
  if (!manifest.scripts?.build) return [];
  const entries = new Set<string>();
  if (typeof manifest.main === "string") entries.add(manifest.main);
  for (const value of Object.values(manifest.exports ?? {})) {
    if (typeof value === "string") entries.add(value);
    else if (value && typeof value === "object") {
      const importEntry = (value as { import?: unknown }).import;
      if (typeof importEntry === "string") entries.add(importEntry);
    }
  }
  return [...entries].filter((entry) => entry.includes("dist/"));
}

/** Workspace packages whose declared entry files are not on disk. */
export function findMissingBuilds(repoRoot: string = root): MissingBuild[] {
  const missing: MissingBuild[] = [];
  for (const group of GROUPS) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir)) {
      const packageDir = join(groupDir, name);
      for (const entry of entryFilesFor(packageDir)) {
        const resolved = join(packageDir, entry);
        if (!existsSync(resolved)) {
          missing.push({ packageName: `${group}/${name}`, entry });
          break;
        }
      }
    }
  }
  return missing;
}

export function ensureWorkspaceBuild(): { built: boolean; missing: string[] } {
  const missing = findMissingBuilds();
  if (missing.length > 0) {
    console.log(
      `Building packages/ + domains/ — missing dist for: ${missing
        .map((item) => item.packageName)
        .join(", ")}`,
    );
  }
  // ALWAYS delegate to turbo, never short-circuit on "the files are there".
  //
  // An earlier version returned early when every entry file existed, which
  // silently reintroduced the problem this script exists to prevent: a `dist/`
  // that is PRESENT but STALE (its source changed since it was built) passed
  // the existence check, so the gate ran against last week's build. Deciding
  // whether a rebuild is needed is exactly what the task cache is for — on a
  // warm tree this whole call is a ~40ms full cache hit, and turbo restores any
  // deleted output from cache rather than rebuilding it.
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=./packages/*",
      "--filter=./domains/*",
    ],
    { stdio: "inherit", cwd: root, timeout: 240_000 },
  );
  if (result.status !== 0) {
    console.error(
      "FAIL turbo run build --filter=./packages/* --filter=./domains/* (prerequisite)",
    );
    process.exit(1);
  }
  return { built: true, missing: missing.map((item) => item.packageName) };
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  ensureWorkspaceBuild();
}
