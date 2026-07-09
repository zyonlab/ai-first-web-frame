/**
 * Filesystem loader for the unit graph: reads the framework's existing
 * artifacts and feeds {@link buildUnitGraph}. The graph builder itself stays
 * pure (and unit-tested); all the I/O + dynamic imports live here so both the
 * `query-registry` CLI and the `mcp-devx` server share one loader.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildUnitGraph,
  type FragmentManifestLike,
  type PageInput,
  type RouteInput,
  type UnitGraph,
} from "./unit-graph";

/** Loads every fragment's `manifest.ts` and normalizes it to the graph shape. */
async function loadFragments(root: string): Promise<FragmentManifestLike[]> {
  const dir = join(root, "fragments");
  if (!existsSync(dir)) return [];
  const out: FragmentManifestLike[] = [];
  for (const name of readdirSync(dir)) {
    const manifestPath = join(dir, name, "src", "manifest.ts");
    if (!existsSync(manifestPath)) continue;
    const mod = (await import(pathToFileURL(manifestPath).href)) as Record<
      string,
      unknown
    >;
    // The fragment exports `<camelName>Manifest`; pick the object literal that
    // looks like a manifest (has a string `name`).
    const manifest = Object.values(mod).find(
      (v): v is FragmentManifestLike =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as { name?: unknown }).name === "string",
    );
    if (manifest) out.push(manifest);
  }
  return out;
}

/** Reads every app's `manifest.slots.json` (page name = app directory name). */
function loadPages(root: string): PageInput[] {
  const dir = join(root, "apps");
  if (!existsSync(dir)) return [];
  const out: PageInput[] = [];
  for (const name of readdirSync(dir)) {
    const slotsPath = join(dir, name, "src", "manifest.slots.json");
    if (!existsSync(slotsPath)) continue;
    const slots = JSON.parse(readFileSync(slotsPath, "utf8"));
    out.push({ name, slots: Array.isArray(slots) ? slots : [] });
  }
  return out;
}

/** Reads the route registry, normalizing `@mvp/page-x` → `page-x`. */
async function loadRoutes(root: string): Promise<RouteInput[]> {
  const registryPath = join(
    root,
    "platform",
    "route-registry",
    "src",
    "registry.ts",
  );
  if (!existsSync(registryPath)) return [];
  const mod = (await import(pathToFileURL(registryPath).href)) as {
    routeRegistry?: { routes?: { path: string; page: string }[] };
  };
  const routes = mod.routeRegistry?.routes ?? [];
  return routes.map((r) => ({
    path: r.path,
    page: r.page.replace(/^@mvp\//, ""),
  }));
}

/** Reads the fragment registry release records. */
function loadRegistry(root: string): Record<string, Record<string, unknown>> {
  const dataPath = join(
    root,
    "platform",
    "fragment-registry",
    "src",
    "registry.data.json",
  );
  if (!existsSync(dataPath)) return {};
  const data = JSON.parse(readFileSync(dataPath, "utf8"));
  return (data.fragments ?? {}) as Record<string, Record<string, unknown>>;
}

/** Assembles the full unit graph from the repo at `root`. */
export async function loadUnitGraph(root: string): Promise<UnitGraph> {
  const [fragments, routes] = await Promise.all([
    loadFragments(root),
    loadRoutes(root),
  ]);
  return buildUnitGraph({
    fragments,
    pages: loadPages(root),
    routes,
    // biome-ignore lint/suspicious/noExplicitAny: registry JSON shape is consumed defensively by the builder.
    registry: loadRegistry(root) as any,
  });
}
