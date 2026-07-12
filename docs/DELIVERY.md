# DELIVERY.md — affected model, GLOBAL triggers, deploy gates

Machine-actionable reference for how a diff becomes a deploy: the single
graph-based affected engine, the exact rules that narrow a change to its
dependency closure (and the exact rules that force a GLOBAL full rebuild), and
the gates a change must pass on its way out (`pnpm verify`, the runtime gate,
E2E tiers). Read this before reasoning about blast radius, CI matrices, or
"do I need to rebuild everything?". Related: [OPERATIONS.md](./OPERATIONS.md)
(the 7-step lifecycle and JSON envelopes), [RELEASE_MODEL.md](./RELEASE_MODEL.md)
(image tagging, k8s, canary), [COMPOSITION.md](./COMPOSITION.md),
[CONTRACTS.md](./CONTRACTS.md), [INTERACTION.md](./INTERACTION.md).

---

## 1. One affected engine

There is exactly **one** affected-detection engine: the pure planner
`tools/release-tools/src/affected-graph.ts` behind the CLI
`scripts/affected-graph.mts` (`pnpm affected:graph [--base <ref>] [--head
<ref>] [--json] [--github-output <file>]`). The legacy heuristic engine
(`scripts/affected.mts` + `tools/release-tools/src/affected.ts`) has been
**deleted** — all three consumers use the graph engine: `.github/workflows/ci.yml`
(docker matrix via `--github-output`), `scripts/deploy-affected.mts`, and
`@mvp/mcp`'s `affected` tool (`packages/mcp/src/tools.ts` shells to
`scripts/affected-graph.mts --json`). One diff, one answer.
(`docs/RELEASE_MODEL.md` §"Affected Detection" still describes the deleted
legacy engine; this document supersedes that section.)

Base resolution (`resolveBase` in `scripts/affected-graph.mts`): explicit
`--base` ref → `origin/main` → `HEAD~1`. Without `--head`, "after" content is
the working tree.

**Output** (`AffectedPlan`, `tools/release-tools/src/affected-graph.ts`):

```ts
{
  seeds: string[];          // directly-changed unit ids
  global: boolean;          // a shared/unresolvable path forced full rebuild
  affectedUnits: string[];  // full reverse-dependency closure
  deployables: string[];    // docker images to rebuild (components + pages [+ shell-gateway])
  affectedPages: string[];  // pages to run verify:runtime against
}
```

### 1.1 How the unit graph is built

`tools/release-tools/src/load-graph.ts` (`loadUnitGraph`) reads the artifacts
that already exist — nothing is separately declared for the graph:

| Input | Source | Graph result |
| --- | --- | --- |
| Fragments | each `fragments/<name>/src/manifest.ts` (+ `@mvp/*` deps from its `package.json`) | `component` units; `depends-on`, `reads` (dataDependencies), `consumes-slice`/`produces-slice`, `uses-package` edges |
| Pages | each `apps/<name>/src/manifest.slots.json` (+ `@mvp/*` deps) | `page` units; `mounts` edges to fragments |
| Packages | every `packages/*/package.json` **and** `domains/*/package.json` | `package` units (`meta.dir` = source dir); `uses-package` edges |
| Routes | `packages/routes/src/registry.ts` | `route` units; `routes` edges to pages |
| Registry | `registry/registry.data.json` | channel/version/serviceUrl stamped onto component units |

`buildUnitGraph` (`tools/release-tools/src/unit-graph.ts`) is pure and
deterministic (sorted units/edges). `affectedClosure(graph, seeds)` walks
**reverse** edges transitively: a changed fragment pulls in every page that
mounts it; a changed package pulls in everything with a `uses-package` path to
it; a changed slice/data-source pulls in its consumers.

`domains/*` packages (e.g. `@mvp/trade-contracts`) are modeled identically to
`packages/*` — same `PackageInput` shape, same `uses-package` closure. This
was an explicit bug fix: before it, a `domains/**` path matched no seeding
branch and fell through with an **empty seed set and `global` left false** —
a silent under-build (see `loadPackageGroup`'s doc comment in
`load-graph.ts` and the `domain` branch in `seedsFromPaths`).

---

## 2. Seeding rules: what narrows, what goes GLOBAL

`seedsFromPaths(graph, paths, options?)` in
`tools/release-tools/src/affected-graph.ts` resolves each changed path, in
this order. This table is the normative list — the source is the doc:

| Changed path | Behavior |
| --- | --- |
| `docs/`, `reports/`, `infra/`, `e2e/`, `tools/`, `.github/`, `.claude/` prefixes; any `*.md` | **Ignored** (the `IGNORED` regex) — seeds nothing, never global. |
| `registry/registry.data.json` | **Narrow** (§4.1, goal B1): content-diffed via the injected `getRegistryFileContent` reader (`RegistryFileReader`; the CLI wires it to `git show <base>:<path>` for "before" and the working tree / `git show <head>:<path>` for "after"). Seeds only the fragment names whose entry changed. No reader supplied → GLOBAL. |
| `registry/releases.json` | **Narrow**, same mechanism (`diffReleasesFragments`). |
| `packages/registry/**`, `packages/routes/**` | **GLOBAL** (`REGISTRY_CODE_PREFIXES`). Registry/routes *code* (mutation logic, route registry) is cross-cutting shared logic even though both are real workspace packages — deliberately conservative, unlike the two *data* files above. |
| `fragments/<name>/**` | Seeds the fragment unit `<name>` if it exists in the graph; an unrecognized fragment dir falls through to GLOBAL. |
| `apps/<name>/**` | Seeds the page unit `<name>`; unrecognized app dir → GLOBAL. |
| `packages/<dir>/**` (all others) | Seeds the `package` unit whose `meta.dir === <dir>`; the closure then pulls in its dependents. Unknown package dir → GLOBAL. |
| `domains/<dir>/**` | Same as `packages/<dir>` (the PR-#7-era fix — see §1.1). Unknown domain dir → GLOBAL. |
| **Anything else** — repo-root config (`pnpm-lock.yaml`, `package.json`, `tsconfig.base.json`, `biome.json`, `vitest.config.ts`, ...), `registry/` files other than the two above, any unmodeled top-level dir | **GLOBAL.** The engine's explicit stance (see the final `else` comment in `seedsFromPaths`): never silently produce an empty seed set — the "silent under-build" is the exact failure mode this module exists to prevent. |

**GLOBAL consequences** (`affectedFromChangedPaths`): every `component` and
`page` unit becomes a deployable, plus `SHELL_UNIT` (`"shell-gateway"` — the
composition gateway is not a graph unit but always ships on a global rebuild).

### 2.1 The registry-write narrow path (goal B1) in detail

Registry data files are the routine *output* of register/promote/rollback —
if they went GLOBAL, every lifecycle write would rebuild the world.

- `diffRegistryDataFragments(before, after)` parses both revisions'
  `{ fragments: {...} }` and returns the names whose entry changed — **added,
  removed, or any channel/version/serviceUrl edit** (deep JSON equality per
  name). `before === undefined` (file new at base) → every present fragment
  is a new registration, still narrow.
- `diffReleasesFragments(before, after)` compares `{ releases: [...] }`
  records **by content, not array index** (append-only in practice, but
  reordering/dedup can't misreport), returning the names on new records.
- **Fallback to GLOBAL on anything ambiguous**: `after` unreadable/deleted,
  malformed/unparseable JSON at either revision, or a diffed fragment name
  the graph doesn't recognize (`applyFragmentDiff` in `seedsFromPaths`).
  Malformed content is never silently narrowed.

Seeded fragments then expand through the normal closure — a promoted fragment
rebuilds itself **plus the pages that mount it**, nothing else.

---

## 3. Deploy gates

### 3.1 `pnpm deploy:affected` (`scripts/deploy-affected.mts`)

```
pnpm deploy:affected [--base <ref>] [--dry-run] [--runtime] [--origin <url>]
```

Flow: `computeAffectedPlan(base)` → build each deployable docker image
**sequentially** (memory-safe) via `docker compose -f
infra/docker/docker-compose.yml build <svc>` → `up -d` only what was built →
with `--runtime`, run the runtime gate per affected page.

Per-page URL resolution (`resolvePageUrl`): each page's path comes from its
own `apps/<page>/src/manifest.ts` `route` field (no hand-kept page→URL
table); dynamic segments are filled from `ROUTE_PARAM_SAMPLES`
(`symbol: "BTC"`, `id: "1"`). An affected page with **no derivable URL is a
failure, not a skip** — a new/misconfigured page cannot silently drop out of
the gate. `--origin` defaults to `$SHELL_URL` or `http://localhost:4100`.

### 3.2 The runtime gate (`pnpm verify:runtime`, `scripts/verify-runtime.mts`)

Manifest-driven, generalized to every composed page. Drives the composed URL
in real Chromium (playwright) and asserts the plane `pnpm verify` cannot see:

- no page errors / console errors (React #418 hydration errors included;
  favicon-404 noise excluded),
- declared static assets actually delivered (no `/_next/static` or `/assets`
  404s),
- no pane strands content above a large void, no page overflow — measured
  against `[data-area]` grid cells when present (trade), else each
  `[data-fragment]` root (every composed page emits one),
- on pages that have one, the signature interaction (order-book row click →
  order-form price) still fires.

Verdict logic is pure and unit-tested in `tools/runtime-gate/src/checks.ts`
(`evaluateRuntime`); the script only collects observations. Usage:
`pnpm verify:runtime [--url http://localhost:4100/trade/BTC] [--json]` —
requires the target stack to be up.

### 3.3 `pnpm verify` — the 14-gate list (`scripts/verify.mts`)

Exit 0 only if all pass; report written to `reports/verify-report.json`
(envelope in [OPERATIONS.md](./OPERATIONS.md) §5).

| # | Gate | What it enforces |
| --- | --- | --- |
| 1 | `pnpm typecheck` | tsgo, per-project tsconfigs |
| 2 | `pnpm lint` | oxlint |
| 3 | `pnpm check` | biome format/lint |
| 4 | `pnpm verify:manifest-gen` | every page with a non-empty `manifest.slots.json` has a fresh `fragmentSlots.gen.ts` (`mount-slot --check`; a missing gen file fails too — discovery is by `manifest.slots.json`, so deleting a gen file cannot drop a page out of the gate; slotless pages with an empty slots array are exempt-and-reported) — manifest↔runtime drift is structurally blocked |
| 5 | `pnpm verify:demos` | `docs/DEMOS.md`'s generated capability table in sync with every page manifest's `demonstrates` array (`scripts/verify-demos.mts --check`; regenerate with `--write`) |
| 6 | `pnpm docs:test` | every `AGENT.md` fenced TypeScript snippet is **executed** (not just typechecked) — doc drift fails like a broken test |
| 7 | `pnpm test` | all Vitest suites (incl. each page's `tests/manifestSync.test.ts` belt-and-suspenders drift check) |
| 8 | `pnpm build` | tsdown / next build for every package |
| 9 | `pnpm audit:similarity` | no near-duplicate components |
| 10 | `pnpm audit:css` | CSS budgets — hard gate |
| 11 | `pnpm audit:deps` | dependency rules: no bare `fetch`, layering (`domain-code-in-framework-package`), orphan-bus (`island-bus-without-escape-hatch` — see [INTERACTION.md](./INTERACTION.md) §5) |
| 12 | `pnpm audit:optimizer` | optimizer conformance |
| 13 | `pnpm audit:boundary` | client/server boundary rules |

### 3.4 E2E tiers (`pnpm e2e`, `E2E_STRICT`)

Fallback isolation is a feature: an unreachable fragment still composes to a
200 with degraded markup stamped `data-fallback="true"`. E2E asserts against
that contract in two tiers (`e2e/support/expect-fragment-content.ts`,
`isE2EStrict()`):

- **Default (lenient)**: live content OR fallback content passes — a
  partially-degraded stack is intentional, correct behavior.
- **Strict (`E2E_STRICT=1`)**: only live content passes; any fallback fails.
  Use when the full stack is expected healthy and e2e must prove **live**
  composition, not graceful degradation.

CI runs e2e on `main` pushes always, and on PRs only with the `e2e` label
(`.github/workflows/ci.yml` `e2e` job).

---

## 4. Release lifecycle tie-in

Step-by-step commands, JSON envelopes, and failure recovery live in
[OPERATIONS.md](./OPERATIONS.md) (register §3, promote §6, rollback §7);
pipeline/image mechanics in [RELEASE_MODEL.md](./RELEASE_MODEL.md). Delivery-
relevant invariants only:

- **register → promote → rollback** all mutate `registry/registry.data.json`
  and append to `registry/releases.json` — i.e. they hit exactly the §2.1
  narrow path: a lifecycle write redeploys only that fragment + its mounting
  pages. Promote records the previous stable under the entry's `versions`
  history; rollback restores it (or an explicit `--to` version present in
  `releases.json`).
- **Version immutability** (`registerFragmentVersion` in
  `packages/registry/src/mutations.ts`): `versions` is append-only —
  re-registering an existing `name+version` with different
  `serviceUrl`/`manifestUrl`/`assetsUrl` values **throws**
  (`versions are append-only — bump the version instead of re-registering an
  existing one`) rather than silently rewriting history. Promote/rollback only
  ever copy an entry's own current `stable`/`canary` value under its own
  version key.
- **Write safety**: all registry/manifest writes are atomic (temp file +
  rename) behind an advisory `<file>.lock` with an optimistic content-hash
  check (`packages/registry/src/atomic-file.ts`); concurrent writers get
  `{"status": "conflict", "retry": true}` — rerun the same command.
- **Env override convention**: `<FRAGMENT_NAME>_URL` (e.g. `PRICE_PANEL_URL`)
  rewrites a registered fragment's `serviceUrl`/`manifestUrl` at runtime
  without a registry write — use for local/staging targeting so the override
  never enters the affected computation at all.
