/**
 * Graph-aware affected detection (docs/AI_NATIVE_DEVX.md §5, Phase 2b).
 *
 * Maps a set of changed file paths to the deployable images that must be rebuilt
 * + the pages that must be re-runtime-verified, by seeding the unit graph from
 * the changed fragment/app dirs and walking its reverse edges
 * ({@link affectedClosure}). Paths under shared roots (`packages/`, `platform/`,
 * repo-root config) can't be resolved to a single unit here, so they mark the
 * run GLOBAL — conservative-correct (rebuild everything). Non-shipping paths
 * (docs, tools, e2e, reports, ci, markdown) are ignored.
 *
 * Exception (docs/ARCHITECTURE_REFACTOR_PLAN.md §4.1): the fragment registry's
 * data files (`registry.data.json`, `releases.json`) are the routine *output*
 * of the register/promote/rollback lifecycle scripts, not shared code — every
 * fragment registration would otherwise force a full-repo rebuild, directly
 * contradicting the minimal-blast-radius goal. Those two paths are diffed
 * content-wise to the fragment name(s) that actually changed and seed only
 * those units; every other `platform/**` path (registry/mutation *code*,
 * route-registry, ...) stays GLOBAL as before.
 *
 * Pure (paths + graph in → plan out) so it is unit-tested; the CLI does the git
 * diff and the docker orchestration.
 */

import { affectedClosure, type UnitGraph } from "./unit-graph";

/** The extra deployable that isn't a graph unit but ships the composition. */
export const SHELL_UNIT = "shell-gateway";

/** The two registry data files special-cased by §4.1 (see module doc). */
export const REGISTRY_DATA_PATH =
  "platform/fragment-registry/src/registry.data.json";
export const RELEASES_PATH = "platform/fragment-registry/releases.json";

/** Content of one of the two registry data files at both ends of a diff.
 * `undefined` means the file did not exist / could not be read at that
 * revision (e.g. brand new file, or deleted). */
export type RegistryFileVersions = {
  before: string | undefined;
  after: string | undefined;
};

/**
 * Supplies before/after content for a registry data path so `seedsFromPaths`
 * can narrow the seed set instead of going GLOBAL. The CLI wires this to
 * `git show <base>:<path>` (before) + the working tree or `git show
 * <head>:<path>` (after); tests can supply a fixed map. When omitted, the two
 * paths fall back to the previous conservative GLOBAL behavior.
 */
export type RegistryFileReader = (path: string) => RegistryFileVersions;

export type SeedsFromPathsOptions = {
  getRegistryFileContent?: RegistryFileReader;
};

type FragmentDiffResult = { global: true } | { global: false; names: string[] };

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Parses `{ fragments: Record<string, unknown> }`, or null if malformed. */
function parseFragmentsMap(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "fragments" in parsed &&
      typeof (parsed as { fragments: unknown }).fragments === "object" &&
      (parsed as { fragments: unknown }).fragments !== null
    ) {
      return (parsed as { fragments: Record<string, unknown> }).fragments;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Diffs `registry.data.json` content to the fragment names whose entry
 * actually changed (added, removed, or a channel/version/serviceUrl edit).
 * Falls back to `{ global: true }` on anything ambiguous: unreadable/deleted
 * content, or malformed/unparseable JSON at either revision.
 */
export function diffRegistryDataFragments(
  before: string | undefined,
  after: string | undefined,
): FragmentDiffResult {
  if (after === undefined) return { global: true };
  const afterFragments = parseFragmentsMap(after);
  if (afterFragments === null) return { global: true };

  if (before === undefined) {
    // File didn't exist at the base ref: every fragment present is a new
    // registration, not an ambiguous change.
    return { global: false, names: Object.keys(afterFragments) };
  }
  const beforeFragments = parseFragmentsMap(before);
  if (beforeFragments === null) return { global: true };

  const names = new Set<string>();
  for (const name of new Set([
    ...Object.keys(beforeFragments),
    ...Object.keys(afterFragments),
  ])) {
    if (!deepEqual(beforeFragments[name], afterFragments[name]))
      names.add(name);
  }
  return { global: false, names: [...names] };
}

/** Parses `{ releases: Array<{ name?: string, ... }> }`, or null if malformed. */
function parseReleases(content: string): Array<Record<string, unknown>> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { releases: unknown }).releases)
    ) {
      return (parsed as { releases: Array<Record<string, unknown>> }).releases;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Diffs `releases.json` content to the fragment name(s) with a new release
 * record. The file is append-only in practice, but records are compared by
 * content (not just array index) so reordering/dedup can't misreport. Falls
 * back to `{ global: true }` on anything ambiguous, same as
 * {@link diffRegistryDataFragments}.
 */
export function diffReleasesFragments(
  before: string | undefined,
  after: string | undefined,
): FragmentDiffResult {
  if (after === undefined) return { global: true };
  const afterReleases = parseReleases(after);
  if (afterReleases === null) return { global: true };

  if (before === undefined) {
    // File didn't exist at the base ref: every recorded release is new.
    return {
      global: false,
      names: afterReleases
        .map((r) => r.name)
        .filter((n): n is string => typeof n === "string"),
    };
  }
  const beforeReleases = parseReleases(before);
  if (beforeReleases === null) return { global: true };

  const remaining = beforeReleases.map((r) => JSON.stringify(r));
  const names = new Set<string>();
  for (const record of afterReleases) {
    const serialized = JSON.stringify(record);
    const index = remaining.indexOf(serialized);
    if (index !== -1) {
      remaining.splice(index, 1);
      continue;
    }
    if (typeof record.name === "string") names.add(record.name);
  }
  return { global: false, names: [...names] };
}

export type AffectedPlan = {
  /** Directly-changed unit ids (fragments / pages). */
  seeds: string[];
  /** A shared/unresolvable path forced a full rebuild. */
  global: boolean;
  /** All units in the affected closure. */
  affectedUnits: string[];
  /** Deployable image names to rebuild (components + pages [+ shell]). */
  deployables: string[];
  /** Pages to run `verify:runtime` against. */
  affectedPages: string[];
};

const IGNORED = /^(docs|reports|infra|e2e|tools|\.github|\.claude)\//;

/** Resolves changed paths to seed unit ids + whether the run is global. */
export function seedsFromPaths(
  graph: UnitGraph,
  paths: string[],
  options?: SeedsFromPathsOptions,
): { seeds: string[]; global: boolean } {
  const seeds = new Set<string>();
  let global = false;
  const hasUnit = (id: string) => graph.units.some((u) => u.id === id);
  /** package unit whose source dir matches `packages/<dir>`. */
  const packageForDir = (dir: string) =>
    graph.units.find((u) => u.kind === "package" && u.meta?.dir === dir);
  /** Applies a §4.1 fragment-name diff result: seed each known unit, or fall
   * back to GLOBAL for a name the graph doesn't recognize (conservative). */
  const applyFragmentDiff = (result: FragmentDiffResult) => {
    if (result.global) {
      global = true;
      return;
    }
    for (const name of result.names) {
      if (hasUnit(name)) seeds.add(name);
      else global = true;
    }
  };
  for (const raw of paths) {
    const path = raw.replace(/\\/g, "/").trim();
    if (!path) continue;
    if (IGNORED.test(path) || path.endsWith(".md")) continue;
    if (path === REGISTRY_DATA_PATH || path === RELEASES_PATH) {
      const reader = options?.getRegistryFileContent;
      if (!reader) {
        global = true; // no way to diff content → conservative
        continue;
      }
      const { before, after } = reader(path);
      applyFragmentDiff(
        path === REGISTRY_DATA_PATH
          ? diffRegistryDataFragments(before, after)
          : diffReleasesFragments(before, after),
      );
      continue;
    }
    const frag = /^fragments\/([^/]+)\//.exec(path);
    const app = /^apps\/([^/]+)\//.exec(path);
    const pkg = /^packages\/([^/]+)\//.exec(path);
    if (frag && hasUnit(frag[1])) seeds.add(frag[1]);
    else if (app && hasUnit(app[1])) seeds.add(app[1]);
    else if (pkg) {
      // Narrow a workspace-package change to the units that depend on it (via
      // the `uses-package` closure) instead of rebuilding everything.
      const unit = packageForDir(pkg[1]);
      if (unit) seeds.add(unit.id);
      else global = true; // unknown package → conservative
    }
    // platform/ (route/fragment registry) is cross-cutting, as is repo-root
    // config (lockfile, tsconfig, biome): rebuild all. (The two registry data
    // files above are the narrowed exception per §4.1.)
    else if (/^platform\//.test(path) || !path.includes("/")) global = true;
  }
  return { seeds: [...seeds].sort(), global };
}

export function affectedFromChangedPaths(
  graph: UnitGraph,
  paths: string[],
  options?: SeedsFromPathsOptions,
): AffectedPlan {
  const { seeds, global } = seedsFromPaths(graph, paths, options);
  const shippable = graph.units.filter(
    (u) => u.kind === "component" || u.kind === "page",
  );
  const affected = global
    ? shippable
    : affectedClosure(graph, seeds).filter(
        (u) => u.kind === "component" || u.kind === "page",
      );
  const deployables = affected.map((u) => u.id).sort();
  if (global) deployables.push(SHELL_UNIT);
  return {
    seeds,
    global,
    affectedUnits: affectedClosure(graph, global ? deployables : seeds)
      .map((u) => u.id)
      .sort(),
    deployables: [...new Set(deployables)].sort(),
    affectedPages: affected
      .filter((u) => u.kind === "page")
      .map((u) => u.id)
      .sort(),
  };
}
