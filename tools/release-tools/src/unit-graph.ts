/**
 * Unit dependency graph (AI-native DevX, doc `docs/AI_NATIVE_DEVX.md` §3).
 *
 * Builds a single queryable graph of the framework's units — routes, pages,
 * components (fragments), and data sources — from the artifacts that already
 * exist today: each fragment's `manifest.ts` (`dependsOn` / `dataDependencies`),
 * each page's `manifest.slots.json` (page→fragment mounts), the route registry,
 * and the fragment registry (channel/version/serviceUrl).
 *
 * This module is PURE (data in → graph out) so it is unit-testable without any
 * filesystem access; the `scripts/query-registry.mts` CLI does the I/O and calls
 * {@link buildUnitGraph}. It answers the questions an agent needs before
 * touching anything: "what exists", "who depends on X", "who reads this source".
 */

export type UnitKind =
  | "route"
  | "page"
  | "component"
  | "data-source"
  | "slice"
  | "package";

/** Machine-readable layout contract (doc §2) — how a pane must size a component. */
export type LayoutHint = {
  minHeight?: number;
  aspect?: number;
  shape?: "bar" | "ladder" | "table" | "chart" | "panel";
  fills?: boolean;
};

export type Unit = {
  /** Stable id, unique across the graph (e.g. "order-book", "page-trade", "route:/trade/:symbol", "book.l2.<symbol>"). */
  id: string;
  kind: UnitKind;
  /** Human name (fragment/page name, route path, source/slice id). */
  name: string;
  owner?: string;
  version?: string;
  renderStrategy?: string;
  /** Registered channel for a component (stable/canary), when known. */
  channel?: string;
  serviceUrl?: string;
  layoutHint?: LayoutHint;
  meta?: Record<string, unknown>;
};

export type EdgeVia =
  | "routes"
  | "mounts"
  | "reads"
  | "depends-on"
  | "consumes-slice"
  | "produces-slice"
  | "uses-package";

export type Edge = { from: string; to: string; via: EdgeVia };

export type UnitGraph = { units: Unit[]; edges: Edge[] };

/** Declared cross-plane coupling (doc §2): C3 slices + C5 data sources. */
export type UnitConsumesProduces = {
  slices?: readonly string[];
  dataSources?: readonly string[];
};

/** The subset of a fragment `manifest.ts` this builder reads. */
export type FragmentManifestLike = {
  name: string;
  owner?: string;
  version?: string;
  renderStrategy?: string;
  dependsOn?: readonly string[];
  dataDependencies?: readonly string[];
  consumes?: UnitConsumesProduces;
  produces?: UnitConsumesProduces;
  layoutHint?: LayoutHint;
  /** `@mvp/*` workspace packages this unit depends on (from its package.json). */
  packageDependencies?: readonly string[];
  metadata?: Record<string, unknown>;
};

/** One mounted slot from a page's `manifest.slots.json`. */
export type PageSlot = {
  name: string;
  fragment: string;
  channel?: string;
  strategy?: string;
  required?: boolean;
};

export type PageInput = {
  name: string;
  owner?: string;
  slots: PageSlot[];
  packageDependencies?: readonly string[];
};

export type RouteInput = { path: string; page: string };

/** A workspace package node: its name, source dir, and `@mvp/*` deps. */
export type PackageInput = {
  name: string;
  dir: string;
  dependsOn?: readonly string[];
};

/** One fragment-registry entry: per-channel release records. */
export type RegistryChannel = { version?: string; serviceUrl?: string };
export type RegistryEntry = Record<string, RegistryChannel | undefined>;

export type BuildUnitGraphInput = {
  fragments: FragmentManifestLike[];
  pages: PageInput[];
  routes?: RouteInput[];
  packages?: PackageInput[];
  registry?: Record<string, RegistryEntry>;
};

const routeId = (path: string) => `route:${path}`;

/** Resolves the registered version/serviceUrl for a fragment (canary preferred, else stable). */
function registryInfo(entry: RegistryEntry | undefined): {
  channel?: string;
  version?: string;
  serviceUrl?: string;
} {
  if (!entry) return {};
  const canary = entry.canary;
  const stable = entry.stable;
  const pick = canary ?? stable;
  return {
    channel: canary ? "canary" : stable ? "stable" : undefined,
    version: pick?.version,
    serviceUrl: pick?.serviceUrl,
  };
}

/**
 * Builds the unit graph. Deterministic: units and edges are sorted so snapshot
 * tests and diffs stay stable.
 */
export function buildUnitGraph(input: BuildUnitGraphInput): UnitGraph {
  const units = new Map<string, Unit>();
  const edges: Edge[] = [];
  const upsert = (unit: Unit) => {
    if (!units.has(unit.id)) units.set(unit.id, unit);
  };

  // Components (fragments).
  for (const fragment of input.fragments) {
    const reg = registryInfo(input.registry?.[fragment.name]);
    upsert({
      id: fragment.name,
      kind: "component",
      name: fragment.name,
      owner: fragment.owner,
      version: reg.version ?? fragment.version,
      renderStrategy: fragment.renderStrategy,
      channel: reg.channel,
      serviceUrl: reg.serviceUrl,
      layoutHint: fragment.layoutHint,
      meta: fragment.metadata,
    });
    // component --depends-on--> component
    for (const dep of fragment.dependsOn ?? []) {
      edges.push({ from: fragment.name, to: dep, via: "depends-on" });
    }
    // component --reads--> data-source (`dataDependencies` + `consumes.dataSources`)
    const dataSources = new Set([
      ...(fragment.dataDependencies ?? []),
      ...(fragment.consumes?.dataSources ?? []),
    ]);
    for (const source of dataSources) {
      upsert({ id: source, kind: "data-source", name: source });
      edges.push({ from: fragment.name, to: source, via: "reads" });
    }
    // component --consumes-slice / produces-slice--> slice (C3 channels)
    for (const slice of fragment.consumes?.slices ?? []) {
      upsert({ id: slice, kind: "slice", name: slice });
      edges.push({ from: fragment.name, to: slice, via: "consumes-slice" });
    }
    for (const slice of fragment.produces?.slices ?? []) {
      upsert({ id: slice, kind: "slice", name: slice });
      edges.push({ from: fragment.name, to: slice, via: "produces-slice" });
    }
    // component --uses-package--> package (@mvp/* workspace deps)
    for (const pkg of fragment.packageDependencies ?? []) {
      edges.push({ from: fragment.name, to: pkg, via: "uses-package" });
    }
  }

  // Pages + page --mounts--> component / --uses-package--> package.
  for (const page of input.pages) {
    upsert({ id: page.name, kind: "page", name: page.name, owner: page.owner });
    for (const slot of page.slots) {
      edges.push({ from: page.name, to: slot.fragment, via: "mounts" });
    }
    for (const pkg of page.packageDependencies ?? []) {
      edges.push({ from: page.name, to: pkg, via: "uses-package" });
    }
  }

  // Packages + package --uses-package--> package (inter-package @mvp deps).
  for (const pkg of input.packages ?? []) {
    upsert({
      id: pkg.name,
      kind: "package",
      name: pkg.name,
      meta: { dir: pkg.dir },
    });
    for (const dep of pkg.dependsOn ?? []) {
      edges.push({ from: pkg.name, to: dep, via: "uses-package" });
    }
  }

  // Routes + route --routes--> page.
  for (const route of input.routes ?? []) {
    upsert({ id: routeId(route.path), kind: "route", name: route.path });
    edges.push({ from: routeId(route.path), to: route.page, via: "routes" });
  }

  const sortedUnits = [...units.values()].sort((a, b) =>
    a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind),
  );
  const sortedEdges = [...edges].sort(
    (a, b) =>
      a.from.localeCompare(b.from) ||
      a.to.localeCompare(b.to) ||
      a.via.localeCompare(b.via),
  );
  return { units: sortedUnits, edges: sortedEdges };
}

/** All units of a given kind. */
export function unitsByKind(graph: UnitGraph, kind: UnitKind): Unit[] {
  return graph.units.filter((u) => u.kind === kind);
}

/** Direct dependents: units with an edge pointing AT `id` (who breaks if it changes). */
export function dependentsOf(graph: UnitGraph, id: string): Unit[] {
  const froms = new Set(
    graph.edges.filter((e) => e.to === id).map((e) => e.from),
  );
  return graph.units.filter((u) => froms.has(u.id));
}

/** Direct dependencies: units `id` points at. */
export function dependenciesOf(graph: UnitGraph, id: string): Unit[] {
  const tos = new Set(
    graph.edges.filter((e) => e.from === id).map((e) => e.to),
  );
  return graph.units.filter((u) => tos.has(u.id));
}

/**
 * Components that read a data source. Matches by source-id PREFIX so a concrete
 * query like "book.l2" finds fragments declaring the C5 template
 * "book.l2.<symbol>" (and vice-versa).
 */
export function consumersOfDataSource(
  graph: UnitGraph,
  sourceId: string,
): Unit[] {
  // Reduce a source id to its literal segment prefix (everything before a
  // `<var>` template hole): "ticker.<symbol>" → "ticker", "book.l2" → "book.l2".
  const prefix = (s: string) => s.split(".<")[0].replace(/\.$/, "");
  // Two prefixes match when one is a dot-segment prefix of the other, so a
  // concrete "ticker.ETH" and a template "ticker.<symbol>" both reduce to
  // compatible "ticker".
  const matches = (a: string, b: string) =>
    a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
  const target = prefix(sourceId);
  const froms = new Set(
    graph.edges
      .filter((e) => e.via === "reads" && matches(prefix(e.to), target))
      .map((e) => e.from),
  );
  return graph.units.filter((u) => froms.has(u.id));
}

/** Components that publish a slice (C3 channel). */
export function producersOfSlice(graph: UnitGraph, slice: string): Unit[] {
  const froms = new Set(
    graph.edges
      .filter((e) => e.via === "produces-slice" && e.to === slice)
      .map((e) => e.from),
  );
  return graph.units.filter((u) => froms.has(u.id));
}

/** Components that subscribe to a slice (C3 channel). */
export function consumersOfSlice(graph: UnitGraph, slice: string): Unit[] {
  const froms = new Set(
    graph.edges
      .filter((e) => e.via === "consumes-slice" && e.to === slice)
      .map((e) => e.from),
  );
  return graph.units.filter((u) => froms.has(u.id));
}

/**
 * Expands a set of directly-changed unit ids to everything that must be
 * re-verified/redeployed, by walking reverse edges transitively: a changed
 * component pulls in its pages; a changed slice/data-source pulls in its
 * consumers; and so on. Returns the closure (including the seeds present in the
 * graph). Backs graph-aware `affected` (doc §5).
 */
export function affectedClosure(
  graph: UnitGraph,
  changed: Iterable<string>,
): Unit[] {
  const closure = new Set<string>();
  const queue: string[] = [];
  for (const id of changed) {
    if (graph.units.some((u) => u.id === id)) {
      closure.add(id);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const dep of dependentsOf(graph, id)) {
      if (!closure.has(dep.id)) {
        closure.add(dep.id);
        queue.push(dep.id);
      }
    }
  }
  return graph.units.filter((u) => closure.has(u.id));
}

export type RegistryQuery = {
  kind?: UnitKind;
  name?: string;
  dependentsOf?: string;
  dependenciesOf?: string;
  consumesDataSource?: string;
  consumesSlice?: string;
  producesSlice?: string;
};

/** One combined query surface (backs the CLI + the MCP `query_registry` tool). */
export function queryRegistry(
  graph: UnitGraph,
  q: RegistryQuery = {},
): { units: Unit[]; edges: Edge[] } {
  let units = graph.units;
  if (q.dependentsOf) units = dependentsOf(graph, q.dependentsOf);
  else if (q.dependenciesOf) units = dependenciesOf(graph, q.dependenciesOf);
  else if (q.consumesDataSource)
    units = consumersOfDataSource(graph, q.consumesDataSource);
  else if (q.consumesSlice) units = consumersOfSlice(graph, q.consumesSlice);
  else if (q.producesSlice) units = producersOfSlice(graph, q.producesSlice);
  if (q.kind) units = units.filter((u) => u.kind === q.kind);
  if (q.name) units = units.filter((u) => u.id === q.name || u.name === q.name);
  const ids = new Set(units.map((u) => u.id));
  const edges = graph.edges.filter((e) => ids.has(e.from) || ids.has(e.to));
  return { units, edges };
}
