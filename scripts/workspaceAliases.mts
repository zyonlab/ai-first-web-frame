/**
 * Workspace `@mvp/*` → source-file alias map, derived from each package's own
 * `package.json#exports`.
 *
 * `vitest.config.ts` used to carry this map BY HAND — ~110 lines listing every
 * package plus every fragment island/manifest/patch entry point, including
 * domain-specific ones in a repo-root config. Adding a package or a fragment
 * subpath meant remembering to edit it, and nothing in the 14 gates checked that
 * it was complete: a missing entry surfaced as a confusing module-resolution
 * failure in an unrelated test. `scripts/docs-test.mts` already derived the same
 * map generically, so this module is that logic, shared.
 *
 * Why an alias map at all: `package.json#exports` points at `dist/`, so without
 * aliases every test would need a prior `pnpm build`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Workspace groups scanned for `@mvp/*` packages, in pnpm-workspace order. */
export const WORKSPACE_GROUPS = [
  "apps",
  "domains",
  "fragments",
  "packages",
  "tools",
];

function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Resolves one `exports` target (or a subpath guess) to a real source file. */
function resolveExportTarget(
  packageDir: string,
  subpath: string,
  target: unknown,
): string | null {
  const literal =
    typeof target === "string"
      ? target
      : target && typeof target === "object"
        ? ((target as { import?: unknown }).import as string | undefined)
        : undefined;
  if (typeof literal === "string") {
    // Already a source entry (fragments export `./src/island.tsx` directly).
    if (literal.includes("/src/")) {
      const direct = join(packageDir, literal);
      if (existsSync(direct)) return direct;
    }
    // A built entry (`./dist/react.js`) maps back to its source sibling. This is
    // what makes `@mvp/fragment-order-book/patch` → `src/ladder.ts` work: the
    // target is authoritative, a `src/<subpath>` guess would be wrong.
    const distMatch = /^\.\/dist\/(.+)\.(js|mjs|cjs)$/.exec(literal);
    if (distMatch) {
      const resolved = firstExisting([
        join(packageDir, `src/${distMatch[1]}.ts`),
        join(packageDir, `src/${distMatch[1]}.tsx`),
        join(packageDir, `src/${distMatch[1]}/index.ts`),
        join(packageDir, `src/${distMatch[1]}/index.tsx`),
      ]);
      if (resolved) return resolved;
    }
  }
  // Last resort: assume the subpath mirrors the source layout.
  return firstExisting([
    join(packageDir, `src/${subpath}.ts`),
    join(packageDir, `src/${subpath}.tsx`),
    join(packageDir, `src/${subpath}/index.ts`),
    join(packageDir, `src/${subpath}/index.tsx`),
  ]);
}

/**
 * Builds the alias map. Keys are ordered longest-first because Vite's
 * object-form `resolve.alias` PREFIX-matches: a shorter key like `@mvp/ui` must
 * not be tested before `@mvp/ui/AppNav`, or the shorter alias wins and the
 * resolved path gets a bogus `/AppNav` suffix.
 */
export function buildWorkspaceAliases(
  repoRoot: string = join(dirname(fileURLToPath(import.meta.url)), ".."),
): Record<string, string> {
  const aliases: Record<string, string> = {};

  for (const group of WORKSPACE_GROUPS) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir)) {
      const packageDir = join(groupDir, name);
      const manifestPath = join(packageDir, "package.json");
      if (!existsSync(manifestPath)) continue;
      let manifest: { name?: string; exports?: unknown };
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch {
        continue;
      }
      const packageName = manifest.name;
      if (!packageName?.startsWith("@mvp/")) continue;

      const rootSource = firstExisting([
        join(packageDir, "src/index.ts"),
        join(packageDir, "src/index.tsx"),
      ]);
      if (rootSource) aliases[packageName] = rootSource;

      const exportsField = manifest.exports;
      if (exportsField && typeof exportsField === "object") {
        for (const [key, target] of Object.entries(
          exportsField as Record<string, unknown>,
        )) {
          if (key === "." || !key.startsWith("./")) continue;
          const subpath = key.slice(2);
          // `./shadcn/globals.css` and friends are assets, not modules.
          if (/\.(css|json)$/.test(subpath)) continue;
          const resolved = resolveExportTarget(packageDir, subpath, target);
          if (resolved) aliases[`${packageName}/${subpath}`] = resolved;
        }
      }
    }
  }

  // `@mvp/ui/*` subpath folders are not listed individually in exports, but
  // tests and pages import them (e.g. `@mvp/ui/AppNav`); the exports map does
  // declare each one, so nothing extra is needed here — this comment records
  // that the wildcard in tsconfig.base.json is deliberate and separate.
  const ordered: Record<string, string> = {};
  for (const key of Object.keys(aliases).sort((a, b) => b.length - a.length)) {
    ordered[key] = aliases[key];
  }
  return ordered;
}
