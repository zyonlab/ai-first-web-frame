/**
 * @deprecated (W1-A, docs/REMEDIATION_PLAN.md) This is the OLD heuristic
 * affected-detection engine. It hardcodes a stale list of 5 `DEPLOYABLE_UNITS`
 * (shell-gateway, page-home, page-product, promotion-banner,
 * recommendation-widget) that predates most of the current fragments/pages
 * (order-book, order-form, page-trade, page-markets, page-portfolio,
 * page-vaults, page-referrals, ...) and never became aware of `domains/*`
 * packages either — both are real correctness gaps, not just staleness.
 *
 * `.github/workflows/ci.yml` and `scripts/deploy-affected.mts` now both use
 * the graph engine instead (`tools/release-tools/src/affected-graph.ts` /
 * `scripts/affected-graph.mts`, driven by `tools/release-tools/src/unit-graph.ts`
 * + `load-graph.ts`, which does model every fragment/page/package/domain as a
 * graph unit). This module is kept only because `packages/mcp/src/tools.ts`'s
 * `affected` MCP tool still shells out to `scripts/affected.mts --list`
 * (that file is outside W1-A's owned-files list, so migrating/removing it is
 * left for a follow-up task — flagged in the W1-A PR). Do not extend this
 * engine further; extend the graph engine instead.
 *
 * Affected deployable-unit detection.
 *
 * nx is configured in nx.json but is not installed in this workspace, so the
 * pipeline computes affected units from a git diff path list plus the pnpm
 * workspace dependency graph (parsed from each package.json). Shared package
 * changes propagate to every deployable unit that transitively depends on
 * them. All functions in this module are pure so they can be unit tested;
 * git and filesystem access live in scripts/affected.mts.
 */

export type WorkspacePackage = {
  /** Package name, e.g. "@mvp/page-home". */
  name: string;
  /** Directory relative to the repo root using posix separators, e.g. "apps/page-home". */
  dir: string;
  /** Names of workspace-internal dependencies ("workspace:*" entries). */
  workspaceDependencies: string[];
};

export type DeployableUnit = {
  /** Short unit name, also used as the Docker image name, e.g. "page-home". */
  unit: string;
  /** Workspace package name backing this unit. */
  packageName: string;
  /** Directory relative to the repo root. */
  dir: string;
  /** Dockerfile path relative to the repo root. */
  dockerfile: string;
  /**
   * Non-workspace path prefixes that are compiled into this unit via relative
   * imports and therefore trigger a rebuild. Empty for every unit today —
   * `@mvp/registry` / `@mvp/routes` (formerly `platform/fragment-registry` /
   * `platform/route-registry`) are real workspace packages now, so their
   * changes are already attributed via `packageForPath` + `buildDependentsIndex`
   * below; this field remains for any future non-package relative import.
   */
  extraPathPrefixes: string[];
};

export type AffectedUnit = {
  unit: string;
  packageName: string;
  dir: string;
  dockerfile: string;
  reasons: string[];
};

export type AffectedResult = {
  changedFiles: string[];
  changedPackages: string[];
  units: AffectedUnit[];
  /** True when a repo-global file forced every unit to be considered affected. */
  matchedAll: boolean;
};

/** The five independently deployable units of this repository. */
export const DEPLOYABLE_UNITS: DeployableUnit[] = [
  {
    unit: "shell-gateway",
    packageName: "@mvp/shell-gateway",
    dir: "apps/shell-gateway",
    dockerfile: "apps/shell-gateway/Dockerfile",
    extraPathPrefixes: [],
  },
  {
    unit: "page-home",
    packageName: "@mvp/page-home",
    dir: "apps/page-home",
    dockerfile: "apps/page-home/Dockerfile",
    extraPathPrefixes: [],
  },
  {
    unit: "page-product",
    packageName: "@mvp/page-product",
    dir: "apps/page-product",
    dockerfile: "apps/page-product/Dockerfile",
    extraPathPrefixes: [],
  },
  {
    unit: "promotion-banner",
    packageName: "@mvp/fragment-promotion-banner",
    dir: "fragments/promotion-banner",
    dockerfile: "fragments/promotion-banner/Dockerfile",
    extraPathPrefixes: [],
  },
  {
    unit: "recommendation-widget",
    packageName: "@mvp/fragment-recommendation-widget",
    dir: "fragments/recommendation-widget",
    dockerfile: "fragments/recommendation-widget/Dockerfile",
    extraPathPrefixes: [],
  },
];

/**
 * Repo-global files: images COPY the whole repo, so dependency lockfile or
 * base tsconfig changes can alter every image's runtime behavior.
 */
export const GLOBAL_PATHS: string[] = [
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package.json",
  "tsconfig.base.json",
  ".dockerignore",
];

/**
 * Paths that never change image runtime behavior. Directory prefixes end
 * with "/"; other entries are exact paths. Markdown anywhere is ignored via
 * IGNORED_SUFFIXES. tools/* packages are excluded naturally by the
 * dependency graph (no deployable unit depends on them).
 */
export const IGNORED_PATH_PREFIXES: string[] = [
  "docs/",
  ".github/",
  "infra/",
  "reports/",
  "e2e/",
  "scripts/",
];

export const IGNORED_PATHS: string[] = [
  "playwright.config.ts",
  "vitest.config.ts",
  "biome.json",
  "oxlint.json",
  "nx.json",
  ".gitignore",
];

export const IGNORED_SUFFIXES: string[] = [".md"];

const hasPrefix = (path: string, prefixes: string[]): boolean =>
  prefixes.some((prefix) => path.startsWith(prefix));

const isIgnoredPath = (path: string): boolean =>
  IGNORED_PATHS.includes(path) ||
  hasPrefix(path, IGNORED_PATH_PREFIXES) ||
  IGNORED_SUFFIXES.some((suffix) => path.endsWith(suffix));

const isGlobalPath = (path: string): boolean => GLOBAL_PATHS.includes(path);

/** Normalize a git diff path to posix separators without a leading "./". */
export function normalizePath(path: string): string {
  const posix = path.trim().replaceAll("\\", "/");
  return posix.startsWith("./") ? posix.slice(2) : posix;
}

/**
 * Parse the fields we need out of a raw package.json object. Only
 * "workspace:" protocol dependencies count as workspace-internal edges.
 */
export function parseWorkspacePackage(
  dir: string,
  packageJson: {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  },
): WorkspacePackage | undefined {
  if (!packageJson.name) return undefined;
  const all = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const workspaceDependencies = Object.entries(all)
    .filter(([, spec]) => spec.startsWith("workspace:"))
    .map(([name]) => name)
    .sort();
  return {
    name: packageJson.name,
    dir: normalizePath(dir),
    workspaceDependencies,
  };
}

/**
 * Build a map from package name to the set of package names that
 * transitively depend on it (including the package itself).
 */
export function buildDependentsIndex(
  packages: WorkspacePackage[],
): Map<string, Set<string>> {
  const directDependents = new Map<string, Set<string>>();
  for (const pkg of packages) {
    if (!directDependents.has(pkg.name)) {
      directDependents.set(pkg.name, new Set());
    }
    for (const dep of pkg.workspaceDependencies) {
      const dependents = directDependents.get(dep) ?? new Set<string>();
      dependents.add(pkg.name);
      directDependents.set(dep, dependents);
    }
  }

  const index = new Map<string, Set<string>>();
  for (const pkg of packages) {
    const reached = new Set<string>([pkg.name]);
    const queue = [pkg.name];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const dependent of directDependents.get(current) ?? []) {
        if (!reached.has(dependent)) {
          reached.add(dependent);
          queue.push(dependent);
        }
      }
    }
    index.set(pkg.name, reached);
  }
  return index;
}

/** Find the workspace package owning a path via longest directory prefix. */
export function packageForPath(
  path: string,
  packages: WorkspacePackage[],
): WorkspacePackage | undefined {
  let best: WorkspacePackage | undefined;
  for (const pkg of packages) {
    const prefix = `${pkg.dir}/`;
    if (path.startsWith(prefix) || path === pkg.dir) {
      if (!best || pkg.dir.length > best.dir.length) best = pkg;
    }
  }
  return best;
}

/**
 * Compute the deployable units affected by a set of changed files.
 *
 * Rules, in order, per changed file:
 * 1. Ignored paths (docs, CI config, infra manifests, markdown, ...) — skip.
 * 2. Repo-global paths (lockfile, root package.json, base tsconfig) — all units.
 * 3. Files inside a workspace package — that package plus transitive dependents.
 * 4. Files matching a unit's extraPathPrefixes (platform registries) — those units.
 * 5. Any other path (unknown root file, unknown platform dir) — all units,
 *    because every image copies the full repo; unknown means "assume affected".
 */
export function computeAffected(
  changedFiles: string[],
  packages: WorkspacePackage[],
  units: DeployableUnit[] = DEPLOYABLE_UNITS,
): AffectedResult {
  const normalized = [...new Set(changedFiles.map(normalizePath))]
    .filter((path) => path.length > 0)
    .sort();
  const dependentsIndex = buildDependentsIndex(packages);
  const unitByPackage = new Map(units.map((unit) => [unit.packageName, unit]));

  const reasonsByUnit = new Map<string, Set<string>>();
  const changedPackages = new Set<string>();
  let matchedAll = false;

  const markUnit = (unit: DeployableUnit, reason: string) => {
    const reasons = reasonsByUnit.get(unit.unit) ?? new Set<string>();
    reasons.add(reason);
    reasonsByUnit.set(unit.unit, reasons);
  };

  const markAll = (reason: string) => {
    matchedAll = true;
    for (const unit of units) markUnit(unit, reason);
  };

  for (const path of normalized) {
    if (isIgnoredPath(path)) continue;

    if (isGlobalPath(path)) {
      markAll(`global file changed: ${path}`);
      continue;
    }

    const owner = packageForPath(path, packages);
    if (owner) {
      changedPackages.add(owner.name);
      for (const dependent of dependentsIndex.get(owner.name) ?? []) {
        const unit = unitByPackage.get(dependent);
        if (unit) {
          markUnit(
            unit,
            owner.name === unit.packageName
              ? `unit source changed: ${path}`
              : `workspace dependency ${owner.name} changed: ${path}`,
          );
        }
      }
      continue;
    }

    const extraMatches = units.filter((unit) =>
      hasPrefix(path, unit.extraPathPrefixes),
    );
    if (extraMatches.length > 0) {
      for (const unit of extraMatches) {
        markUnit(unit, `relative-import path changed: ${path}`);
      }
      continue;
    }

    markAll(`unmatched path (conservative rebuild): ${path}`);
  }

  const affectedUnits: AffectedUnit[] = units
    .filter((unit) => reasonsByUnit.has(unit.unit))
    .map((unit) => ({
      unit: unit.unit,
      packageName: unit.packageName,
      dir: unit.dir,
      dockerfile: unit.dockerfile,
      reasons: [...(reasonsByUnit.get(unit.unit) ?? [])].sort(),
    }));

  return {
    changedFiles: normalized,
    changedPackages: [...changedPackages].sort(),
    units: affectedUnits,
    matchedAll,
  };
}

/** Build the GitHub Actions matrix payload for the docker build job. */
export function toGithubMatrix(result: AffectedResult): {
  include: Array<{ unit: string; dir: string; dockerfile: string }>;
} {
  return {
    include: result.units.map(({ unit, dir, dockerfile }) => ({
      unit,
      dir,
      dockerfile,
    })),
  };
}
