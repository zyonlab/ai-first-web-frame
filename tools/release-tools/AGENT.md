# @mvp/release-tools — AGENT.md

## What this package is for

`@mvp/release-tools` is the pure logic layer behind the repo's release/DevX
CLIs: the unit dependency graph ("what exists / who depends on X"), the
graph-aware affected engine (changed paths → deployables + pages to
runtime-verify), the docker-compose smoke suite, and mount-time layout
advisories. Every module is pure (data in → verdict out) and unit-tested; the
I/O lives in the consuming CLIs — `scripts/query-registry.mts`,
`scripts/deploy-affected.mts`, `scripts/docker-smoke.mts`,
`scripts/mount-slot.mts` — and in `packages/mcp`'s `query_registry` /
`affected_units` tools. There is deliberately no `src/index.ts`: consumers
import the specific module (`tools/release-tools/src/unit-graph`, ...).

## Entry points

**`src/unit-graph.ts`** — the queryable unit graph (docs/AI_NATIVE_DEVX.md §3):

- `buildUnitGraph(input: BuildUnitGraphInput): UnitGraph` — pure builder from
  `{ fragments: FragmentManifestLike[], pages: PageInput[], routes?, packages?, registry? }`
  to `{ units: Unit[], edges: Edge[] }`. Unit kinds: `route | page | component
  | data-source | slice | package`; edge kinds (`via`): `routes | mounts |
  reads | depends-on | consumes-slice | produces-slice | uses-package`.
  Deterministic (sorted units/edges) so snapshots and diffs stay stable.
  Registry entries fill a component's `channel`/`version`/`serviceUrl`
  (canary preferred over stable).
- `dependentsOf(graph, id)` / `dependenciesOf(graph, id): Unit[]` — direct
  reverse/forward neighbors.
- `affectedClosure(graph, changed: Iterable<string>): Unit[]` — transitive
  reverse closure (a changed component pulls in its pages, a changed slice its
  consumers, ...); includes the seeds that exist in the graph.
- `consumersOfDataSource(graph, sourceId): Unit[]` — matches by dot-segment
  PREFIX so a concrete `"ticker.ETH"` finds fragments declaring the template
  `"ticker.<symbol>"` and vice-versa.
- `producersOfSlice` / `consumersOfSlice(graph, slice): Unit[]` — C3 channels.
- `unitsByKind(graph, kind): Unit[]`.
- `queryRegistry(graph, q: RegistryQuery): { units, edges }` — the one
  combined query surface behind the CLI and the MCP tool (`kind`, `name`,
  `dependentsOf`, `dependenciesOf`, `consumesDataSource`, `consumesSlice`,
  `producesSlice`).
- `LayoutHint` — `{ minHeight?, aspect?, shape?: "bar" | "ladder" | "table" |
  "chart" | "panel", fills? }`, the machine-readable layout contract fragment
  manifests carry (consumed by `layout-advisories` and the dev harness).

**`src/affected-graph.ts`** — changed paths → deploy plan (doc §5, Phase 2b):

- `seedsFromPaths(graph, paths: string[], options?): { seeds: string[]; global: boolean }`
  — `fragments/<x>/**`, `apps/<x>/**` seed that unit; `packages/<dir>/**` and
  `domains/<dir>/**` seed the matching `package` unit (narrowed via
  `uses-package` closure); docs/reports/infra/e2e/tools/.github/.claude and
  `*.md` are ignored; anything unresolvable sets `global: true`
  (conservative-correct: rebuild everything). Exceptions: the two registry
  DATA files (`REGISTRY_DATA_PATH` = `registry/registry.data.json`,
  `RELEASES_PATH` = `registry/releases.json`) are content-diffed to the
  fragment names that actually changed via
  `options.getRegistryFileContent: (path) => { before, after }` (no reader →
  GLOBAL), while registry/routes *code* (`packages/registry/`,
  `packages/routes/`) stays GLOBAL by design.
- `diffRegistryDataFragments(before, after)` /
  `diffReleasesFragments(before, after): { global: true } | { global: false; names: string[] }`
  — the content diffs behind that narrowing; any unreadable/malformed side
  falls back to `{ global: true }`.
- `affectedFromChangedPaths(graph, paths, options?): AffectedPlan` —
  `{ seeds, global, affectedUnits, deployables, affectedPages }`; deployables
  are affected components + pages, plus `SHELL_UNIT` (`"shell-gateway"`) on a
  global run; `affectedPages` feeds `verify:runtime`.

**`src/load-graph.ts`** — the filesystem loader (I/O lives here, not in the
builder): `loadUnitGraph(root: string): Promise<UnitGraph>` reads every
fragment `manifest.ts` (dynamic import), every page's `manifest.slots.json`,
`packages/*` + `domains/*` package.json files, the route registry, and
`registry/registry.data.json`. `loadFragmentManifest(root, name)` validates
against `FragmentManifestSchema.passthrough()` from `@mvp/contracts`.

**`src/smoke.ts`** — docker-compose smoke logic (CLI: `scripts/docker-smoke.mts`):

- `createDefaultSmokeChecks(host = "localhost"): SmokeCheck[]` — the default
  health/composition checks against the local compose stack (shell 4100,
  fragments 4201+, pages 4101+).
- `evaluateCheck(check, response: { status, body }): { ok, missingSubstrings }`
  — pure: status must equal `expectStatus` and the body must contain every
  `expectSubstrings` entry.
- `runSmokeSuite(checks, fetcher, options?): Promise<SmokeSuiteResult>` —
  polls failing checks until all pass or `timeoutMs` (default 120s) elapses;
  HTTP (`fetcher`) and `sleep`/`now` are injected so it is testable with no
  network.

**`src/layout-advisories.ts`** — `layoutAdvisories(hint: LayoutHint | undefined,
ctx: { fragment, slot }): string[]` — mount-time advisory strings `mount-slot`
pushes onto its `warnings`: a missing hint, `fills` panes needing a stretching
cell, `minHeight`/`aspect` reservations, and a closing "confirm with
`pnpm verify:runtime`" reminder. The cheap static counterpart to the runtime
`layout-fit` check.

## Error taxonomy

- The pure modules (`unit-graph`, `affected-graph`, `smoke`,
  `layout-advisories`) throw nothing on well-typed input; ambiguity is
  reported in-band (`global: true`, `ok: false`, advisory strings) instead of
  thrown.
- `loadFragmentManifest`/`loadUnitGraph` throw a plain `Error`
  (`"FragmentManifestSchema: fragment \"<name>\" has an invalid manifest.ts — <issues>"`)
  when a manifest fails the contracts schema — a malformed manifest must kill
  graph construction loudly, because the graph feeds the affected engine and
  CI matrices. `readJson` failures (malformed slots/registry JSON) propagate
  as raw `SyntaxError`/`ENOENT`.
- `runSmokeSuite` never throws on HTTP failure: a fetcher error is captured
  per-check as `{ ok: false, error }` and retried until the deadline.

## Example

Imports are written for where `docs:test` executes this snippet
(`tools/release-tools/.docs-test-tmp/`); from other tools use the full
`tools/release-tools/src/...` path.

```ts
import { buildUnitGraph, consumersOfDataSource, dependentsOf } from "../src/unit-graph";
import { affectedFromChangedPaths, SHELL_UNIT } from "../src/affected-graph";
import { evaluateCheck } from "../src/smoke";
import { layoutAdvisories } from "../src/layout-advisories";

const graph = buildUnitGraph({
  fragments: [
    {
      name: "order-book",
      dataDependencies: ["book.l2.<symbol>"],
      produces: { slices: ["trade.order-draft-price"] },
      layoutHint: { shape: "ladder", minHeight: 480, fills: true },
    },
    { name: "market-header", consumes: { slices: ["trade.active-symbol"] } },
  ],
  pages: [
    { name: "page-trade", slots: [{ name: "book", fragment: "order-book" }] },
  ],
  routes: [{ path: "/trade/:symbol", page: "page-trade" }],
  registry: { "order-book": { stable: { version: "1.2.0" } } },
});

// Registry info lands on the component unit; reverse edges answer "who breaks".
const orderBook = graph.units.find((u) => u.id === "order-book");
if (orderBook?.version !== "1.2.0" || orderBook.channel !== "stable")
  throw new Error("registry channel/version not resolved");
if (dependentsOf(graph, "order-book").map((u) => u.id).join() !== "page-trade")
  throw new Error("page-trade must depend on order-book");

// Prefix matching: a concrete source id finds the template declaration.
if (consumersOfDataSource(graph, "book.l2.ETH")[0]?.id !== "order-book")
  throw new Error("template/concrete data-source match");

// Changed paths -> deploy plan. A fragment edit narrows; a lockfile goes GLOBAL.
const narrow = affectedFromChangedPaths(graph, [
  "fragments/order-book/src/render.tsx",
  "docs/ARCHITECTURE.md", // ignored
]);
if (narrow.global) throw new Error("fragment edit must not be global");
if (narrow.deployables.join() !== "order-book,page-trade")
  throw new Error(`unexpected deployables: ${narrow.deployables.join()}`);
if (narrow.affectedPages.join() !== "page-trade") throw new Error("runtime-verify set");

const global = affectedFromChangedPaths(graph, ["pnpm-lock.yaml"]);
if (!global.global || !global.deployables.includes(SHELL_UNIT))
  throw new Error("unresolvable path must rebuild everything incl. shell");

// Smoke evaluation is pure: status + required substrings.
const check = {
  id: "shell-home-composed",
  url: "http://localhost:4100/",
  expectStatus: 200,
  expectSubstrings: ['data-shell-gateway="true"'],
};
if (!evaluateCheck(check, { status: 200, body: '<html data-shell-gateway="true">' }).ok)
  throw new Error("smoke pass");
if (evaluateCheck(check, { status: 502, body: "" }).ok) throw new Error("smoke fail");

// Mount-time layout advisories for a fills/tall fragment.
const advisories = layoutAdvisories(orderBook?.layoutHint, {
  fragment: "order-book",
  slot: "book",
});
if (!advisories.some((a) => a.includes("STRETCHES"))) throw new Error("fills advisory");
if (!advisories.some((a) => a.includes("minHeight ≥ 480px"))) throw new Error("minHeight advisory");
```

## Accept

```
pnpm --filter @mvp/release-tools test
```
Expected: Vitest exits 0. `unit-graph.test.ts` covers graph building/queries
and closure math, `affected-graph.test.ts` the narrow-vs-GLOBAL seeding rules
and registry-data diff narrowing, `load-graph.test.ts` the manifest schema
gate, `smoke.test.ts` the polling/retry suite with injected fetcher/clock, and
`layout-advisories.test.ts` the advisory strings.
