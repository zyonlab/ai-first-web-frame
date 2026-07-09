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
 * Pure (paths + graph in → plan out) so it is unit-tested; the CLI does the git
 * diff and the docker orchestration.
 */

import { affectedClosure, type UnitGraph } from "./unit-graph";

/** The extra deployable that isn't a graph unit but ships the composition. */
export const SHELL_UNIT = "shell-gateway";

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
): { seeds: string[]; global: boolean } {
  const seeds = new Set<string>();
  let global = false;
  const hasUnit = (id: string) => graph.units.some((u) => u.id === id);
  for (const raw of paths) {
    const path = raw.replace(/\\/g, "/").trim();
    if (!path) continue;
    if (IGNORED.test(path) || path.endsWith(".md")) continue;
    const frag = /^fragments\/([^/]+)\//.exec(path);
    const app = /^apps\/([^/]+)\//.exec(path);
    if (frag && hasUnit(frag[1])) seeds.add(frag[1]);
    else if (app && hasUnit(app[1])) seeds.add(app[1]);
    else if (/^(packages|platform)\//.test(path) || !path.includes("/"))
      global = true;
  }
  return { seeds: [...seeds].sort(), global };
}

export function affectedFromChangedPaths(
  graph: UnitGraph,
  paths: string[],
): AffectedPlan {
  const { seeds, global } = seedsFromPaths(graph, paths);
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
