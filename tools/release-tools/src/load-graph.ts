/**
 * Filesystem loader for the unit graph: reads the framework's existing
 * artifacts and feeds {@link buildUnitGraph}. The graph builder itself stays
 * pure (and unit-tested); all the I/O + dynamic imports live here so both the
 * `query-registry` CLI and the `mcp-devx` server share one loader.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FragmentManifestSchema } from "@mvp/contracts";
import {
  buildUnitGraph,
  type FragmentManifestLike,
  type PackageInput,
  type PageInput,
  type RouteInput,
  type UnitGraph,
} from "./unit-graph";

/** Reads the `@mvp/*` runtime dependencies from a package.json (or []). */
function readMvpDeps(pkgJsonPath: string): string[] {
  if (!existsSync(pkgJsonPath)) return [];
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    return Object.keys(pkg.dependencies ?? {})
      .filter((d) => d.startsWith("@mvp/"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Fragment manifests carry repo-convention fields the contracts schema does
 * not model (`layoutHint`, `consumes`, `produces`, `dataDependencies`,
 * `endpoint`, `metadata`, ...). `.passthrough()` keeps them out of scope here:
 * the contract fields are validated hard, everything extra rides along
 * untouched. Adding those fields to `@mvp/contracts` is a separate decision.
 */
const FragmentManifestLoaderSchema = FragmentManifestSchema.passthrough();

/**
 * Validates a found manifest object against `FragmentManifestSchema` (H1).
 * A malformed manifest must kill graph construction loudly — the graph feeds
 * the affected engine and CI matrices, so silently accepting a duck-typed
 * object turns one bad manifest into garbage downstream.
 */
function parseFragmentManifest(
  fragment: string,
  manifest: FragmentManifestLike,
): FragmentManifestLike {
  const result = FragmentManifestLoaderSchema.safeParse(manifest);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `FragmentManifestSchema: fragment "${fragment}" has an invalid manifest.ts — ${issues}`,
    );
  }
  // Return the original object (not the parse output) so unknown convention
  // fields and the exact shapes of valid manifests reach the graph unchanged.
  return manifest;
}

/**
 * Loads one fragment's `manifest.ts` object (or null if absent).
 * Throws with the schema name if the manifest fails `FragmentManifestSchema`.
 */
export async function loadFragmentManifest(
  root: string,
  name: string,
): Promise<FragmentManifestLike | null> {
  const manifestPath = join(root, "fragments", name, "src", "manifest.ts");
  if (!existsSync(manifestPath)) return null;
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
  if (!manifest) return null;
  return parseFragmentManifest(name, manifest);
}

/** Loads every fragment's `manifest.ts` and normalizes it to the graph shape. */
async function loadFragments(root: string): Promise<FragmentManifestLike[]> {
  const dir = join(root, "fragments");
  if (!existsSync(dir)) return [];
  const out: FragmentManifestLike[] = [];
  for (const name of readdirSync(dir)) {
    const manifest = await loadFragmentManifest(root, name);
    if (manifest)
      out.push({
        ...manifest,
        packageDependencies: readMvpDeps(join(dir, name, "package.json")),
      });
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
    out.push({
      name,
      slots: Array.isArray(slots) ? slots : [],
      packageDependencies: readMvpDeps(join(dir, name, "package.json")),
    });
  }
  return out;
}

/**
 * Reads every workspace package's name + `@mvp/*` deps under `<root>/<group>`
 * for the package graph. Used for both `packages/` and `domains/` (W1-A):
 * domain packages (`domains/trade-contracts`, `trade-data`, `trade-prefs`,
 * `trade-theme`, `trade-chart`) are workspace packages in exactly the same
 * shape as `packages/*` — a `package.json` name + `@mvp/*` deps — so they get
 * the same `package` graph unit + `uses-package` reverse-dependency-closure
 * treatment. Before this, `domains/**` was never scanned at all: a change
 * under a domain package produced an empty seed set instead of pulling in
 * the fragments/pages that depend on it (silent under-build).
 */
function loadPackageGroup(root: string, group: string): PackageInput[] {
  const dir = join(root, group);
  if (!existsSync(dir)) return [];
  const out: PackageInput[] = [];
  for (const name of readdirSync(dir)) {
    const pkgPath = join(dir, name, "package.json");
    if (!existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        name?: string;
      };
      if (pkg.name)
        out.push({
          name: pkg.name,
          dir: name,
          dependsOn: readMvpDeps(pkgPath),
        });
    } catch {
      // skip unreadable package.json
    }
  }
  return out;
}

/** Reads the route registry, normalizing `@mvp/page-x` → `page-x`. */
async function loadRoutes(root: string): Promise<RouteInput[]> {
  const registryPath = join(root, "packages", "routes", "src", "registry.ts");
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
  const dataPath = join(root, "registry", "registry.data.json");
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
    packages: [
      ...loadPackageGroup(root, "packages"),
      ...loadPackageGroup(root, "domains"),
    ],
    // biome-ignore lint/suspicious/noExplicitAny: registry JSON shape is consumed defensively by the builder.
    registry: loadRegistry(root) as any,
  });
}
