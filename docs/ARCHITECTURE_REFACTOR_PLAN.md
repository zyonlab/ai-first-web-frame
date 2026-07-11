# Architecture Refactor Plan — Goals-First, Production-Ready, npm-Distributable

> Last updated: 2026-07-11. Status: plan of record for the refactor cycle.
>
> Relationship to other docs: [AI_NATIVE_PRODUCTION_READY_FRAMEWORK_PLAN.md](AI_NATIVE_PRODUCTION_READY_FRAMEWORK_PLAN.md)
> defines the capability domains; [AI_NATIVE_DEVX.md](AI_NATIVE_DEVX.md) defines the
> unit-manifest/MCP/dev-harness direction. This document sequences the **structural
> refactor** that the 2026-07-09 design review showed is needed to actually hit the
> three goals, and adds what neither doc covers: package re-layering, npm
> distribution, the demo-as-reference contract, and the AI-consumer documentation
> system. Where they overlap, this document wins on ordering; they win on detail.
>
> Audience note: this framework is **AI-first — its consumers are AI agents, not
> humans**. Every design decision below is scored against "can an agent that has
> never seen this repo do the right thing from machine-readable surfaces alone?"

## 0. The three goals, as measurable acceptance criteria

Everything in this plan traces to one of these. A workstream that serves none of
them is out of scope (see §8 guardrails).

### 🎯A — AI-first operability
An agent performs every standard operation through a queryable/callable surface
with a machine-readable contract, and misuse fails loudly at the earliest edge.

**Definition of done:**
- A1. Mounting a fragment into a page end-to-end = **1 CLI/MCP call + generated
  code, 0 hand-edited files** (today: 1 scripted file + ~5 hand edits).
- A2. Every runtime boundary (`/render` body, slot config, channel names, bus
  payloads, island snapshots) is schema-validated; a wrong input produces a
  structured error naming the schema, never silent fallback.
- A3. Every CLI prints the uniform `{status, action, files, warnings, error}`
  envelope (already true) **and** refuses semantically-invalid operations
  (mounting an unregistered fragment is an error, not a warning).
- A4. No two framework concepts share a name with different semantics
  (today: slot-strategy `isr` vs Next ISR).

### 🎯B — Minimal blast radius
The affected set for any change is the true dependency closure, never GLOBAL for
routine operations.

**Definition of done:**
- B1. A registry write (register/promote/rollback) affects **only that fragment's
  dependents** (today: GLOBAL — every registry write rebuilds the world).
- B2. A domain-contract change (e.g. a trade slice) affects only that domain's
  closure (today: it lives in `@mvp/interaction`, so it hits every consumer of
  the generic bus, including unrelated pages).
- B3. `packages/**` contains zero domain code; a dependency-audit rule fails the
  build if domain code re-enters a framework package.

### 🎯C — Single-service independent shipping
A fragment ships alone, and version skew between its runtime-resolved SSR output
and any build-frozen client code is detected, not silent.

**Definition of done:**
- C1. SSR/patch-only fragment: promote → live with **0 page rebuilds** (already
  true; keep it true through the refactor).
- C2. React-island fragment: snapshot/props contract change either hydrates
  compatibly or **degrades explicitly** (skip hydration, keep SSR HTML, report) —
  never silently mis-hydrates (today: unguarded skew window).
- C3. (Stretch, decide at P3 gate) island JS resolved at runtime via import map +
  versioned asset URLs from the registry, making island changes independently
  shippable too.

## 1. Findings that force this refactor (condensed)

From the 2026-07-09 review; details in the session notes and
[GAP_ANALYSIS.md](GAP_ANALYSIS.md).

1. **The declarative surface is decorative.** `manifest.slots.json` neither
   drives nor validates the runtime (`fragmentSlots.ts` + `page.tsx` are
   hand-written) and has already drifted (page-product declares 4 slots, runtime
   wires 3; page-home `promotion.required` disagrees between JSON and TS).
2. **Routine registry writes trigger GLOBAL rebuilds** (`platform/**` is
   unconditionally global in `affected-graph.ts`), contradicting 🎯B.
   **Status: fixed (§4.1)** — `registry.data.json` / `releases.json` writes are
   now content-diffed and seed only the changed fragment unit(s); every other
   `platform/**` path (registry/mutation code, route-registry) still goes GLOBAL.
3. **Demo domain code leaked into framework packages**: `trade-client` is a
   whole demo package under `packages/`; trade-specific sections were appended to
   `interaction`, `data`, `storage`, `design-system`. Root cause: no layering
   rule existed, so parallel agents dropped domain output into the nearest
   framework package.
4. **Contract bypass at the edges**: fragment manifests are ad-hoc `as const`
   objects (not `FragmentManifestSchema`-parsed); `/render` bodies are cast, not
   parsed; `channel` is `string`; fallback detection sniffs
   `data-fallback="true"` in HTML.
5. **Island version-skew window**: SSR HTML + `data-island-props` come from the
   live fragment service, the hydrating component is frozen in the page bundle;
   no handshake exists.
6. **Composition is blocking**: `await executeFragmentSlots` before any byte is
   sent; no Suspense/streaming; composed pages are `force-dynamic` even when
   their slots are static/cacheable.
7. **Lifecycle scripts are lock-free read-modify-write** — unsafe under the
   parallel-agent usage the framework is built for.
8. **`platform/` is not a workspace package** (relative-path imported), which
   both blocks npm distribution and forces the GLOBAL affected heuristic.

## 2. Target package architecture (🎯B, 🎯C, npm)

### 2.1 Three layers, one direction

```
apps/ + fragments/            product layer (demo = reference implementation)
        │  may import ▼
domains/<name>-*              domain layer: contracts + data sources + theme
        │  may import ▼          bridges for one business domain
packages/ (@mvp/*)            framework layer: domain-agnostic, npm-published
```

Imports only point downward. `packages/**` importing from `domains/**` or
`apps/**` is a build failure (new dependency-audit rule
`domain-code-in-framework-package`, which also greps framework packages for
registered domain vocabularies, e.g. `trade`).

### 2.2 Moves (mechanical, one PR, behavior-preserving)

| From | To | Note |
| --- | --- | --- |
| `packages/trade-client/store.ts` | `packages/store` (`@mvp/store`) | already generic (`createTradeStore` → `createSliceStore`, `useStoreSlice`) |
| `packages/trade-client/island.tsx` (registry, `hydrateIslands`) | `packages/islands` (`@mvp/islands`) | becomes the home of the C2 handshake |
| `packages/trade-client/chart.tsx` | `domains/trade-chart` | demo-only |
| `packages/interaction/src/trade/*` | `domains/trade-contracts` | remove `export * from "./trade"` from the framework facade |
| `packages/data` trade source registry + `createTradeDataClient` | `domains/trade-data` | |
| `packages/storage` trade prefs (watchlist, recent symbols) | `domains/trade-prefs` | |
| `packages/design-system` `createTradeAliasVariables` | `domains/trade-theme` | |
| `platform/fragment-registry` | `packages/registry` (`@mvp/registry`) | joins the workspace; enables npm publish and per-entry affected (§4.1). `platform/route-registry` follows the same move as `@mvp/routes`. |

`registry.data.json` / `releases.json` stay where operators expect them
(repo-root `registry/` directory) and are loaded by `@mvp/registry` via an
explicit path — data files are deployment state, not package source.

> **Scaffolding status:** the P1-prep task already created empty, passing,
> npm-shaped packages at every destination above except `packages/registry`
> (`domains/trade-contracts`, `domains/trade-data`, `domains/trade-prefs`,
> `domains/trade-theme`, `domains/trade-chart`, `packages/store`,
> `packages/islands`, plus the `auditPackageLayering` check wired into
> `audit:deps`), so the real migration PR only moves code in.

**Status: implemented (P1 phase 3).** `platform/fragment-registry` and
`platform/route-registry` moved into the workspace as `packages/registry`
(`@mvp/registry`) and `packages/routes` (`@mvp/routes`); `platform/` no longer
exists. `registry.data.json` / `releases.json` moved out of package source into
the root-level `registry/` directory exactly as described above; every
resolver (the lifecycle scripts, `@mvp/registry` itself, `load-graph.ts`,
`affected-graph.ts`) now points at `registry/registry.data.json` /
`registry/releases.json`. The §4.1 narrow-affected special-casing in
`tools/release-tools/src/affected-graph.ts` was repointed to the new data-file
paths and now also explicitly keeps `packages/registry/**` / `packages/routes/**`
*code* changes GLOBAL (the same conservative policy `platform/**` had before,
preserved via an explicit prefix check now that those paths would otherwise
match the generic per-package narrowing every other `packages/*` change gets).
`apps/shell-gateway` and every page that reads the fragment registry
(`page-home`, `page-product`, `page-markets`, `page-portfolio`, `page-trade`)
now depend on `@mvp/registry` (and `shell-gateway` also on `@mvp/routes`) as
normal workspace packages instead of relative-importing across `platform/`.

**Status: B3 closed.** The two leaks the P1-prep task deliberately left
flagged-not-scheduled (see REMEDIATION_PLAN.md "Deliberately NOT in this
plan") are now moved, closing goal B3 for real: `packages/data/src/transport/**`
(the mock realtime market-data transport — seeded PRNG, frame generators,
fixtures, `createMockSubscriptionTransport`; entirely trade-market-data-specific,
not a framework primitive) moved to `domains/trade-data/src/transport/**` and is
no longer re-exported from `@mvp/data`'s public surface; and `packages/design-system`'s
`buy`/`sell`/`up`/`down` semantic colors moved to `domains/trade-theme`, which now
owns both their values and their theme-scoped CSS emission (`--trade-buy`/
`--trade-sell`/`--trade-up`/`--trade-down`, defined once per
`:where([data-theme="..."])` block) using `emitDeclarations`, newly exported as
a public `@mvp/design-system` API so a domain package can define its own
theme-aware tokens without reinventing CSS-string emission. Both moves are
behavior-preserving (byte-identical hex values; the mock transport's frame
shapes/determinism are untouched) — only ownership moved, per the layering rule
in §2.1. The dependency-audit's `auditPackageLayering` check is import-edge-only
and never caught either leak (they were inlined values/logic, not cross-layer
imports), so there is no `KNOWN_LEAKS` entry to remove; `pnpm audit:deps`
simply continues to pass clean.

**Gate:** `pnpm verify` green; affected-graph tests updated; the new layering
audit passes; zero `trade` tokens under `packages/`.

### 2.3 npm distribution shape

Published (independently versioned via changesets): `@mvp/contracts`, `runtime`,
`request`, `request-context`, `data`, `storage`, `store`, `islands`,
`interaction`, `observability`, `optimizer`, `registry`, `routes`, `ui`,
`design-system`, `design-tokens`, `create-component` (bin), `release-tools`
(bins: `register-fragment`, `mount-slot`, `promote-fragment`,
`rollback-fragment`, `affected`, `verify-runtime`), `@mvp/audits` (the six
audits as a preset).

Not published: `domains/*` (demo), `apps/*`, `fragments/*`, `infra`.

Rules:
- `react`/`next`/`fastify` are peerDependencies; contracts export **both** Zod
  schemas and generated JSON Schema (`zod-to-json-schema`) so non-TS agents can
  validate.
- Every published package ships an `AGENT.md` (see §6) in its `files` list.
- Semver discipline: breaking a Zod schema or CLI envelope = major. The
  similarity/budget/boundary audits run in CI on the published surface to keep
  the API honest.

**Status: implemented for the 17 non-MCP, non-release-tools packages (P5a).**
`@changesets/cli` is a root devDependency (`pnpm exec changeset` /
`version-packages` / `release` scripts; `release` runs `changeset publish` and
is not wired into any CI trigger — it stays a manual, human-run command).
`.changeset/config.json` sets `baseBranch: "main"` and an `ignore` list
(`@mvp/page-*`, `@mvp/shell-gateway`, `@mvp/fragment-*`, `@mvp/trade-*`, and
the non-publishable `tools/*` audit CLIs) so `apps/*`/`fragments/*`/`domains/*`
are excluded from versioning even though `domains/*` packages don't carry
`"private": true`. `@mvp/contracts`, `runtime`, `request`, `request-context`,
`data`, `storage`, `store`, `islands`, `interaction`, `observability`,
`optimizer`, `registry`, `routes`, `ui`, `design-system`, `design-tokens`, and
`create-component` (now unmarked `private`, with a `bin` entry and a `tsdown`
build producing a self-contained bin script) each carry a `files: ["dist",
"README.md", "AGENT.md"]` allow-list, `repository`/`homepage` pointing at this
repo, and `zod-to-json-schema`-backed `toJsonSchema()` plus ready-made
`FragmentManifestJsonSchema`/`PageManifestJsonSchema`/`FragmentRegistryJsonSchema`/
`FragmentRenderRequestJsonSchema`/`FragmentRenderResponseJsonSchema`/
`RequestContextJsonSchema` exports on `@mvp/contracts`. `react`/`react-dom`
were already peerDependencies (with `peerDependenciesMeta.optional` where the
package's non-React entry point doesn't need them, e.g. `@mvp/runtime`'s core
vs. `./react` subpath) everywhere they're used — no package in this list had
`react`/`next`/`fastify` as a regular `dependency` to move. `pnpm pack
--dry-run` for all 17 (`npm pack --dry-run`, since this pnpm version has no
`--dry-run` flag) shows only `dist/`, `README.md` (where present),
`AGENT.md` (where present — absent files in `files` are a confirmed silent
no-op, not an error), and `package.json` in every tarball; no `node_modules`,
no source `.test.ts` leakage.
**Status: license + publish access decided by the repo owner.** MIT was
chosen (root `LICENSE` file, copyright Joe Wong 2026) — the permissive,
zero-friction default for a framework meant for broad external adoption
(including by AI-agent consumers, per the plan's audience note in §0), with
no signal favoring a copyleft or patent-grant license instead. All 17
packages' `"license"` field is now `"MIT"` (was the `"UNLICENSED"`
placeholder), each gained `"publishConfig": {"access": "public"}` (required
for a scoped `@mvp/*` package to publish without a paid npm org), and
`.changeset/config.json`'s top-level `"access"` was flipped from
`"restricted"` to `"public"` to match. `packages/mcp` (§7.3's `@mvp/mcp`,
packaged from the former `tools/mcp-devx` in a parallel task) wasn't in the
original 17-package batch and got the same `"license": "MIT"` +
`publishConfig` treatment applied here, for consistency. `tools/release-tools`
is unaffected by this pass — it stays `private: true`/unbuilt; the lifecycle
scripts it contains are consumed via `tsx`/child-process invocation, not as
an installable package, so it has no publish-readiness need today.
`packages/assets`/
`packages/workers` exist as unmarked-private workspace packages not
mentioned by this plan's publish/not-published lists, so they were left
untouched by both the `package.json` changes and the changesets `ignore`
list.

**Status: `packages/ui` export mismatch fixed.** Both `./shadcn/globals.css`
and `./tailwind.config` pointed at raw source-tree files
(`src/shadcn/globals.css`, root `tailwind.config.ts`) outside the `files`
allow-list — a real npm consumer would 404 on either. Fixed by making both
real build outputs: `tailwind.config.ts` is now a second `tsdown` entry
(`dist/tailwind.config.js`/`.d.ts`), and `globals.css` is copied to
`dist/shadcn/globals.css` as a build-script post-step, with both exports
repointed at `dist/`. One pitfall worth recording: mixing a package-root
entry (`tailwind.config.ts`) into the SAME `tsdown` invocation as the
existing `src/*` entries changed tsdown's common-ancestor computation for
output paths, silently nesting every component's output under an extra
`dist/src/` segment and breaking every other subpath export — the fix is
two separate `tsdown` invocations (component entries, then
`tailwind.config.ts` with `--no-clean` so the second run doesn't wipe the
first's output), not one invocation with mixed entry roots.

## 3. Manifest-driven composition (🎯A — the biggest single win)

Kill the two-sources-of-truth problem by making `manifest.slots.json` (extended)
the only slot declaration, with generated runtime wiring.

1. **Extend the slot schema** to carry what today only lives in TS: `props`,
   `cachePolicy`, `dataDependencies` (ids referencing the page's data-source
   registry), `staticHtml` ref, `required`. `PageManifestSchema` already has
   most fields; add `dataDependencies` and reconcile `dependsOn`.
2. **Codegen instead of hand-wiring**: `mount-slot` gains a generate step that
   emits `src/fragmentSlots.gen.ts` (slot array, return type, diagnostics
   mapping) from the manifest. Hand code shrinks to the page's data resolvers
   and the JSX placement of each `<FragmentSlot name="..."/>`.
3. **`<FragmentSlot>` component** (`@mvp/runtime/react`): looks up the slot
   result by name, renders HTML + fallback + (later) Suspense boundary. Removes
   the per-slot hand-written `dangerouslySetInnerHTML` blocks.
4. **Drift becomes impossible, then illegal**: while any hand-written slot array
   remains, a verify-time cross-check asserts manifest ↔ runtime equality
   (in progress as a spun-off task). After codegen lands, the check asserts the
   gen file is fresh (`--check` mode in CI).
5. **mount-slot hardening**: unregistered fragment → error (`--allow-unregistered`
   escape hatch); missing `layoutHint` on the fragment → warning that
   `create-component` no longer produces (scaffold now emits a `layoutHint`
   skeleton).

**Gate:** A1 measured — mounting the next new fragment touches 0 hand-edited
files besides JSX placement; the two known drifts are gone; e2e still green.

**Status: implemented and rolled out to all five pages (P2).** Items 1–3
above were first exercised end-to-end on page-home alone to prove the
pattern, then extended to `page-product`, `page-markets`, `page-portfolio`,
and `page-trade`:

- `PageManifestSchema.slots` (`packages/contracts/src/index.ts`) gained
  `dataDependencies: string[]` (mirroring `@mvp/runtime`'s
  `FragmentSlotDefinition.dataDependencies`); `props`, `cachePolicy`,
  `staticHtml`, `dependsOn`, `required` already existed on the schema and now
  actually get populated by `mount-slot` instead of only living hand-written
  in `fragmentSlots.ts`.
- `scripts/mount-slot.mts` gained a codegen step: after every successful
  mount/unmount it regenerates `apps/<page>/src/fragmentSlots.gen.ts` — a
  `FragmentSlotDefinition[]` built directly from `manifest.slots.json` (pure
  transform in `packages/registry/src/codegen.ts`, run through `biome format`
  before writing so it's always `pnpm check`-clean) — and only touches the
  file when its content actually changed. A new `--check` flag loads the
  current manifest, computes what the gen file should be, and diffs it
  against disk without writing anything, returning `{status: "fresh" |
  "stale", ...}` and exiting 1 when stale.
- `<FragmentSlot>` (`packages/runtime/src/react.tsx`, published as
  `@mvp/runtime/react` so the Node-safe core never pulls React into non-React
  consumers) replaces the hand-written `<FragmentHtml html fallback>` pattern:
  `<FragmentSlot name="promotion" execution={execution} fallback={...} />`
  looks a slot up by name in a full `executeFragmentSlots` result (or accepts
  an already-resolved `FragmentRenderResponse` directly) and renders
  `dangerouslySetInnerHTML` or the fallback — byte-for-byte the same rendered
  output as before.
- Every page's `fragmentSlots.ts` now imports its generated static slot
  config from `./fragmentSlots.gen.ts` and only hand-writes what isn't a
  manifest fact: the per-request `timeoutMs` override, the
  `resolveData`/data-client glue, and — for `page-trade`, whose 9 slots all
  carry a per-request `props.symbol` the static manifest can't express — a
  `generatedSlots.map(slot => ({ ...slot, timeoutMs, props }))` merge that
  layers dynamic props onto the generated base at request time. Every page's
  `page.tsx` uses `<FragmentSlot>` in place of a local `FragmentHtml` helper.
  `page-product`'s hand-rendered `reserved: true` `price-panel` slot is
  correctly excluded from codegen and untouched, as designed. Rendered
  output, `data-*` attributes, and every existing test (including each
  page's `manifestSync.test.ts`, and `page-trade`'s `hydrate.test.tsx` /
  `tradeStore`-driven island wiring, which codegen never touches) are
  unchanged.
- `pnpm verify:manifest-gen` (`scripts/verify-manifest-gen.mts`) runs
  `mount-slot --page <page> --check` for every page with a
  `fragmentSlots.gen.ts` — now all five pages (`page-home`, `page-product`,
  `page-markets`, `page-portfolio`, `page-trade`) — and is wired into
  `pnpm verify`'s gate list, so a stale generated file fails CI the same way
  a lint error would.

**Follow-up now available:** with every page on the generated pattern, item
4's per-page `manifestSync.test.ts` drift-check (`diffManifestAgainstRuntime`)
is now fully redundant with `--check` for every page (it was already
redundant for page-home) and could be retired in favor of relying solely on
`verify:manifest-gen` — left in place for now as a belt-and-suspenders
check since it's cheap and still passes. Item 5 (mount-slot hardening) was
already shipped in P0 and is unaffected by this phase.

## 4. Delivery plane (🎯B, 🎯C)

### 4.1 Narrow affected for registry writes
Special-case `registry.data.json` / `releases.json` diffs in `seedsFromPaths`:
parse changed fragment names, seed only those units (dependent pages come from
the existing closure). Code changes under `packages/registry` src stay GLOBAL.
Converge the legacy `affected.mts` onto the graph implementation — one
affected engine. (Done — see Status below.)

**Status: implemented, engines fully converged.** `tools/release-tools/src/affected-graph.ts`
now diffs `registry/registry.data.json` and `registry/releases.json` content
(base ref vs. head/working tree, via a `getRegistryFileContent` reader the CLI
wires to `git show`) and seeds only the fragment(s) that actually changed —
added, removed, or with a channel/version/serviceUrl edit — falling back to
GLOBAL on any malformed or unreadable content. Every other `packages/registry/**`
/ `packages/routes/**` path (mutation code, route-registry) is unchanged and
still GLOBAL. The legacy heuristic engine (`scripts/affected.mts` +
`tools/release-tools/src/affected.ts`) has been deleted: `.github/workflows/ci.yml`
and `scripts/deploy-affected.mts` already used the graph engine, and the one
remaining consumer — `packages/mcp/src/tools.ts`'s `affected` MCP tool — now
shells to `scripts/affected-graph.mts --json` instead of the old
`scripts/affected.mts --list`. One affected engine, one answer per diff, no
follow-up remaining.

### 4.2 Concurrency-safe lifecycle writes
All registry/manifest mutations go through one writer utility: temp file +
atomic rename + an advisory lockfile + optimistic content-hash check (reject
with `status:"conflict"` and a retry hint — agents retry cheaply). Parallel
agents are the normal case, not the edge case.

### 4.3 Island runtime (ordered; decide C3 only after C2 ships)
1. **Snapshot handshake (C2)**: fragments stamp `data-island-props` with
   `{fragment, version, contractHash}`; `@mvp/islands.hydrateIslands` verifies
   against the page-bundled island's expected hash; mismatch → skip hydration,
   keep SSR HTML, emit an observability event + diagnostics entry. Cheap, ships
   independently, converts silent skew into explicit degradation.
2. **One bus, no orphans**: `@mvp/islands` exposes `getIslandBus()` bound to the
   page-owned store; fragments are forbidden (audit rule) from calling
   `createInteractionBus` directly in island code. Fixes the known
   market-header/chart/account-bar orphan-bus gap.
3. **Runtime island assets (C3, stretch)**: adopt the Podium model — the
   registry entry carries versioned, immutable asset URLs; pages emit an import
   map + `<script type="module">` per island instead of build-time imports.
   Go/no-go at the P3 gate based on real demand for island-only ships; until
   then `manifest.assets.js` is explicitly documented as "served for standalone
   demos, not consumed by composition".

**Status: implemented (items 1–2; item 3 — see the C3 spike status note at
the end of this section).**
`packages/islands/src/index.ts`'s `IslandSnapshot` now carries optional
`fragment`/`version`/`contractHash` alongside `props`/`slice`; `registerIsland`
takes an optional third `{ expectedVersion, expectedContractHash }` argument,
and `mountIsland`/`hydrateIslands` skip hydration (leaving the SSR HTML as the
final static state) on a mismatch, `console.warn` unconditionally, and invoke
an optional `configureIslandRuntime({ onSnapshotMismatch })` hook instead of
calling `@mvp/observability` directly (a browser-side package has no business
depending on that request-scoped, server-side API surface). A snapshot with no
`version` at all (an old/non-participating fragment) hydrates normally rather
than being treated as a mismatch, for backward compatibility. The four trade
React fragments (market-header, chart-panel, account-bar, order-form) now
stamp `fragment`/`version` from their own manifest in their SSR snapshot, and
`apps/page-trade/src/hydrate.tsx`'s `registerTradeIslands` declares
`expectedVersion` for all four from each fragment's `<pkg>/manifest` export.
Item 2 shipped as an injected `bus?: InteractionBus` prop each island prefers
over its own `createInteractionBus` fallback (mirroring the pattern
market-header/chart-panel already used) rather than a `getIslandBus()`
accessor — `account-bar` (the one fragment with no escape hatch) now has one,
closing the orphan-bus gap, and `registerTradeIslands` injects the shared page
bus into all three read-mostly islands. A new `tools/dependency-audit`
regex-heuristic check (`island-bus-without-escape-hatch`) fails any
`fragments/*/src/island.tsx` that calls `createInteractionBus` without also
declaring a `bus?`/`props.bus` escape hatch, preventing recurrence.

**Status: item 3 (C3) — spike, validated on one fragment, merged to main
as PR #1 (`spike/p3-c3-island-import-map`); the go/no-go decision on a full
rollout is still open.** A risk-controlled
spike, scoped to exactly one React island (`order-form`), proved the
mechanism works end to end in a real browser without touching the other
three islands' production (build-time static import) path. Findings, in the
order a go/no-go call needs them:

- **What was built.** `fragments/order-form/src/island.browser.ts` is a new
  tsdown entry (`pnpm --filter @mvp/fragment-order-form run
  build:island-browser`, chained into that package's `build` script) that
  bundles `island.tsx` + its exclusive local logic (`islandLogic.ts`,
  `placeOrderFlow.ts`) plus a thin `mountOrderFormIsland(el, props)` wrapper
  (`createRoot(el).render(...)`, the moral equivalent of `@mvp/islands`'
  `mountIsland` for a module reached outside the page's own bundle) into
  ~4.6KB minified browser ESM. `fragments/order-form/src/server.ts` gained a
  real `GET /assets/order-form.island.js` route serving that built file byte
  for byte (`no-store` cache — an unversioned path, see limitations below).
  `apps/page-trade` gained a `tsdown.vendor.config.ts` build
  (`build:spike-vendor`, chained into `next build`) producing a shared
  vendor chunk in `public/spike-vendor/` (Next's static asset serving — the
  simplest self-hosted option, no new server code needed), and a new
  `<script type="importmap">` + `SpikeOrderFormLoader` client component
  (`apps/page-trade/src/hydrateSpike.tsx`) rendered ADDITIVELY alongside the
  existing `TradeHydrator` in `app/trade/[symbol]/page.tsx` — mounted into
  its own sandbox DOM node, never the production `data-island="orderForm"`
  node, so the existing path was never at risk. `FragmentRegistryEntrySchema`
  (`packages/contracts/src/index.ts`) gained an optional `assetsUrl` field
  (threaded through `@mvp/registry`'s types/mutations and
  `register-fragment.mts --assets-url`); order-form's registry entry is the
  only one that sets it — every other fragment's entry is byte-identical to
  before.
- **1. Standalone browser bundle, externals excluded — validated, with a
  correction to the plan's own assumption.** `island.tsx`'s only actual
  runtime imports beyond local files are `react`, `@mvp/trade-contracts`
  (value exports), and `@mvp/ui/shadcn`'s `Slider` — confirmed by inspecting
  the real build output, not assumed. `@mvp/store` turned out to be a
  type-only import (erased at build time, nothing to externalize) and
  `@mvp/islands` is never imported by `island.tsx` at all (only by the
  page's hydration bootstrap) — both named in this plan's original C3
  wording, neither actually needed action. tsdown/rolldown's default
  library-bundling behavior already externalizes every bare `node_modules`
  specifier with zero `--external` flags (confirmed empirically); the
  explicit flags in `build:island-browser` are self-documentation, not load
  -bearing. `@mvp/ui/shadcn` (not one of the four originally-named
  externals) had to be resolved somehow since it's externalized by that same
  default and the island can't render without it — added to the shared
  chunk rather than force-bundled, one more `noExternal` vendor entry.
- **2. Real HTTP-served bundle — validated.** `curl`/browser network trace
  both confirm `GET http://localhost:4205/assets/order-form.island.js`
  returns real JS with `content-type: text/javascript`, not manifest
  metadata.
- **3. Shared chunk, built once, self-hosted — validated, with a build
  -tooling pitfall worth recording.** `noExternal: () => true` (not the
  boolean shorthand `true` — reading tsdown's own `ExternalPlugin` source
  showed `true` is compared to a string id with `===` and so silently never
  matches, falling through to normal externalization with no error) plus
  multi-entry code-splitting produces exactly one physical React module
  shared by every vendor entry point (`react.js`/`react-dom-client.js`/
  `react-jsx-runtime.js`/`ui-shadcn.js` all import the same relative chunk —
  confirmed by reading the built output, not assumed). A second pitfall,
  found only by loading the page in a real browser: `export * from
  "<cjs-package>"` does **not** reliably produce static ESM named exports
  when re-exporting a CommonJS-shaped package (`react`, `react/jsx-runtime`,
  `react-dom/client`) — the build reported success with no warning, but the
  resulting chunk had no static `export {...}` at all, so every named import
  from it failed at runtime (`does not provide an export named 'jsxs'`).
  Fixed by naming every export explicitly (`export { jsx, jsxs, Fragment }
  from "react/jsx-runtime"`) instead of wildcard-exporting; real ESM
  packages (`@mvp/trade-contracts`, `@mvp/ui/shadcn` — both workspace source,
  not CJS) never hit this. `minify: true` + `define: {
  "process.env.NODE_ENV": '"production"' }` were needed too — without them
  the chunk shipped React's full development build (734KB unminified vs.
  191KB total after both fixes).
- **4. Import map + runtime `import()` — validated, plus a real deployment
  problem this spike exists to surface.** The emitted `<script
  type="importmap">` and the dynamic `import(moduleUrl)` (a non-literal
  argument, so bundlers/Turbopack cannot statically inline it — confirmed by
  reading the actual network trace, which shows a genuine runtime fetch of
  `http://localhost:4205/assets/order-form.island.js` from the
  `localhost:4103` page) both work as designed. What was NOT anticipated
  going in: order-form's asset lives on a different origin than the
  consuming page, and an ES module fetch — including one reached via dynamic
  `import()` — is always performed in CORS mode. Without an
  `Access-Control-Allow-Origin` header the browser blocked the import
  outright with an opaque-response error; `curl` and a Vitest unit test both
  missed this entirely (neither enforces CORS) — only loading the real page
  in a real browser caught it. Fixed with a permissive `*` header on the one
  new route (fine for a public, non-credentialed static asset; a real
  rollout should scope it to known consumer origins instead).
- **5. Real, observable, end-to-end proof — validated in a real browser,
  method documented.** `curl` confirmed the static HTML contract (import map
  JSON, loader markup). Beyond that, `next dev` (page-trade) + the real
  `order-form`/`market-header`/`chart-panel`/`account-bar`/`order-book`/
  `trades-feed`/`positions-table`/`open-orders`/`funding-bar` fragment
  services were started for real and driven with the `chrome-devtools` MCP
  tool against `http://localhost:4103/trade/BTC`: the network log shows the
  cross-origin `order-form.island.js` fetch and all five `spike-vendor/*.js`
  chunks resolving `200`; the console was clean (no "React is not defined",
  no duplicate-instance/invalid-hook-call warnings — the only entries were
  an unrelated `/favicon.ico` 404 and a pre-existing accessibility note);
  `evaluate_script` confirmed the loader's own status text reached `"mounted
  via import map + runtime dynamic import()"` with the full rendered form
  (including the Radix `Slider`) inside the sandbox node. Strongest proof:
  dispatching a real click on an order-book price cell moved BOTH the
  production order-form's price input AND the spike-mounted sandbox's price
  input to the same clicked price in the same event — the signature
  cross-island flow, working identically through both loading paths at
  once, because both mount against the exact same shared `getTradeStore()`
  instance (confirmed both by the browser check and by a Vitest test in
  `apps/page-trade/src/hydrateSpike.test.tsx` asserting `deps.store ===
  getTradeStore()`).
- **6. Registry schema — validated, minimal, backward-compatible.**
  `assetsUrl` is `z.string().url().optional()`; every other fragment's
  registry entry is byte-for-byte unchanged; `FragmentVersion`/
  `RegisterFragmentInput` thread it through as an optional field throughout
  `@mvp/registry`.
- **What a full rollout to all four React islands would additionally need**
  (none of this was needed for a one-fragment spike, all of it would be for
  a real cutover): (a) per-fragment vendor-chunk *composition* — this spike
  hand-built one shared chunk for one island's exact dependency set; three
  more islands sharing overlapping-but-not-identical dependencies (each
  fragment's own slice of `@mvp/ui/shadcn`, for instance) needs a real
  dependency-graph-driven chunk builder, not a hand-maintained entry list;
  (b) immutable, versioned asset URLs — today's `/assets/order-form.island.js`
  is a stable, unversioned path with `Cache-Control: no-store`; a real
  rollout needs a content-hashed or version-segmented URL so it can be
  cached aggressively and so two live versions can coexist during a
  canary/stable split (the registry's `versions` map already has room for
  this — `assetsUrl` just needs to vary per version); (c) CORS policy
  scoped to known consumer origins instead of `*`; (d) wiring
  `tools/bundle-budget-check`'s `stats.json` to the real built artifact size
  instead of the declarative-only `budget.ts` numbers it compares today
  (noted in `fragments/order-form/src/budget.ts`); (e) an env-override story
  for `assetsUrl` mirroring the existing `serviceUrl`/`manifestUrl`
  `<NAME>_URL` override convention (today's `withOverride` in
  `packages/registry/src/registry.ts` passes `assetsUrl` through unchanged
  even when the service URL is overridden — fine for a single-fragment
  spike, wrong for multi-environment deploys); (f) a decision on whether the
  import map is built once per page-load (as here) or cached/shared across
  navigations, and whether every page needs its own vendor chunk or a
  shell-level one is shared across pages entirely (out of scope for a
  single-page, single-fragment spike). None of these are blockers — they're
  exactly the kind of follow-up work a stretch-goal spike is supposed to
  surface before a real investment decision, and every one of them is
  additive to what this spike already proved works.

### 4.4 Rendering: streaming + SSG (🎯C for content freshness, plus UX)
1. Rename slot strategy `isr` → `ttl-cache` (A4). One-line codemod + schema alias
   during a deprecation window.
2. Per-slot async server components wrapped in `Suspense`, DAG levels mapped to
   boundaries; `executeFragmentSlots` keeps owning ordering/timeout/fallback but
   returns per-slot promises instead of one barrier.
3. Page-level render config becomes derivable: all-static/ttl slots → the
   scaffold suggests `force-static`/`revalidate` (the vaults/referrals pattern);
   mixed pages evaluate Next PPR once stable.

**Gate:** composed home page streams (shell HTML first byte before slowest slot
resolves) with e2e-verified fallback semantics unchanged.

**Status: items 2–3 implemented. Item 2 was piloted on page-home, then
rolled out to page-product, page-markets, and page-portfolio (PR #14) — 4 of
the 5 composed pages now stream. page-trade deliberately stays on the barrier
`executeFragmentSlots` API: streaming was actually prototyped there and
reverted, because `react-dom/server` cannot execute async Server Components
outside Next's real RSC runtime and `trade-nav.test.tsx` would need bespoke
test infra (documented in docs/DEMOS.md). Item 1 — the `isr` → `ttl-cache`
rename — shipped for live slot manifests via CLI codemod (PR #9); the schema
keeps `"isr"` as a deprecated alias during the deprecation window, and the
separate fragment-manifest `renderMode: "isr"` enum value (a different
concept) is untouched.**

- Item 2: `packages/runtime/src/index.ts` gained `streamFragmentSlots`, which
  runs the same DAG-aware scheduling `executeFragmentSlots` always has, but
  returns *immediately* — a `Promise<FragmentRenderResponse>` per declared
  slot plus one `Promise<FragmentSlotsExecution>` aggregate — instead of one
  barrier `await`. `executeFragmentSlots` is now built on top of it (awaits
  `.result`), so the two stay behaviorally identical by construction; every
  other page's `executeFragmentSlots`/`fetchFragmentSlots` call site is
  untouched. `packages/runtime/src/react.tsx` gained `<FragmentSlotStream
  slotPromise fallback>`, an async Server Component that awaits its own
  slot's promise and renders through the same helper `<FragmentSlot>` uses,
  so `<Suspense fallback={...}><FragmentSlotStream .../></Suspense>` streams
  that slot in the moment its own promise settles. `apps/page-home` (the
  only page touched this phase, matching how P2 was piloted) now renders a
  static shell with no await, three `<Suspense>`+`<FragmentSlotStream>`
  boundaries (one per fragment slot), and a fourth `<Suspense>` boundary
  around the scheduler-health/hints/trace-log diagnostics section (which
  inherently needs the full aggregate and so still resolves last — correct,
  not a regression). Every `data-*` attribute and fallback string is
  unchanged from the pre-streaming markup. Proof: an automated test
  (`packages/runtime/src/index.test.ts`, "streamFragmentSlots streaming
  order") shows a fast slot's promise settling strictly before a
  deliberately delayed slow slot's promise, using real timers; a manual
  check — real `next dev` server for `page-home`, two fake fragment
  backends (one instant, one delayed under the per-slot timeout), `fetch()`
  reading the chunked response — showed the shell + fast slot's HTML
  arriving in one flush (~15ms after headers) and the slow slot's HTML (plus
  the diagnostics section that depends on it) arriving in a distinctly later
  second flush (~150ms after the first, matching the artificial delay),
  confirmed via `Transfer-Encoding: chunked` with no `Content-Length`. Plain
  `react-dom/server` (no Next.js RSC pipeline) cannot render async Server
  Components at all in this stack (confirmed empirically: it throws
  "Objects are not valid as a React child (found: [object Promise])"), so a
  from-scratch `renderToReadableStream`/`renderToPipeableStream` unit test
  bypassing Next.js was not possible — the manual `next dev` check stands in
  for that per the plan's own fallback guidance.
- Item 3: audited all five composed pages' `manifest.slots.json` against the
  `page-vaults`/`page-referrals` `force-static`/`revalidate` pattern. None
  qualify, for two independent reasons: (a) every page's `page.tsx` calls
  `headers()` to build its per-request `RequestContext` (fresh trace/request
  ID, tenant, locale, session on every request) — a genuine dynamic API
  usage, not incidental; (b) four of the five pages also declare at least
  one `dynamic-ssr` slot backed by real per-request data (recommendations,
  portfolio account state, trade positions/orders) that would go stale under
  page-level ISR. `page-markets` (single `cached-ssr` slot, 5s TTL) came
  closest but is still disqualified by (a) — a "near-realtime ticker" is the
  wrong candidate for an hours-long page-level revalidate window regardless.
  No `revalidate`/`force-static` was applied anywhere; freshness semantics
  are unchanged. Incidental finding, not acted on (out of scope — page-home
  only this phase): `page-vaults`'s own `revalidate = 3600` is inert in
  practice — its shared layout also calls `headers()` for a theme cookie,
  and `next build`'s route table reports `/vaults` as `ƒ (Dynamic)`, not
  `○ (Static)` like `/referrals` (which uses `force-static`, not
  `revalidate`, and has no dynamic-API call in its layout).

## 5. Maturity alignment matrix (adopt/adapt/skip)

Aligning generic capabilities with proven designs to reach production-ready
cheaply — never at the cost of the core differentiators (typed contracts,
publisher ACL, hard gates, HTTP failure isolation, lifecycle CLI).

| Mature source | Capability | Decision | Where |
| --- | --- | --- | --- |
| Podium | podlet manifest with runtime-resolved, versioned asset URLs | **Adopt** (C3) | §4.3.3 |
| Podium | MessageBus | **Skip** — ours is typed + ACL'd; theirs is weaker | — |
| OpenComponents | immutable, versioned artifacts in a registry | **Adapt**: enforce `versions[x]` immutability in `@mvp/registry` mutations (append-only, no overwrite) | §2.2, §4.2 |
| OpenComponents | registry as an HTTP service | **Defer** — file registry + env overrides suffice until multi-repo consumers exist | — |
| Piral | feed-service discovery | **Skip** — registry covers it | — |
| Piral | extension-slot API ergonomics | **Adapt** as `<FragmentSlot name>` | §3.3 |
| Module Federation | runtime shared-dependency negotiation | **Skip** — build-time single-version policy (pnpm + dependency-audit) is simpler and already enforced | — |
| Next.js | Suspense streaming / PPR / ISR | **Adopt** | §4.4 |
| Astro server islands | defer-and-swap placeholder pattern | **Adapt** inside the Suspense refactor | §4.4 |
| Nx | affected task graph | **Already adapted**; converged onto one engine | §4.1 |
| Changesets | independent semver + automated npm publish | **Adopt** | §2.3 |
| OpenTelemetry | trace export | **Already aligned** (OTLP JSON) | — |
| qiankun / single-spa | JS sandboxing | **Skip** — HTTP isolation makes it unnecessary | — |

## 6. Demo = the reference implementation (the contract, not an afterthought)

The demos are the training corpus future AI consumers imitate. Rule: **a demo
may only use public framework surfaces** — if a demo needs a bespoke path, that
is a framework gap to fix, not a demo hack to keep. The domain re-layering (§2)
makes the trade demo double as the reference for "how to add a domain".

Each demo page owns a competency and says so in its manifest
(`demonstrates: [...]`, surfaced at `/manifest/*` and in the docs index):

| Surface | Must showcase |
| --- | --- |
| `page-home` | basic composition: static + ttl-cache + dynamic-ssr slots, fallback isolation, trace panel |
| `page-product` | ISR-style freshness, reserved slots, per-slot props/data deps |
| `page-trade` (flagship) | DAG scheduling, cross-island interaction via typed bus + shared store, snapshot handshake, layoutHint-driven placement, budgets under load |
| `page-vaults` / `page-referrals` | page-level ISR / SSG composition (already exist — promote to documented patterns) |
| one fragment pair | canary → promote → rollback walkthrough with `releases.json` history |

Demo acceptance: every framework capability listed in §5 "Adopt/Already" is
exercised by at least one demo page, and `verify:runtime` (generalized per page
from its manifest — no more hard-coded trade selectors) passes for all of them.

## 7. Documentation system for AI consumers (ship with the packages)

Humans get prose; agents get **contracts, examples, and executable acceptance**.
Three tiers, all generated or verified in CI so they cannot rot:

1. **Per-package `AGENT.md`** (published in the npm tarball): what the package
   is for, the 3–5 entry points with exact signatures, the error taxonomy, one
   complete copy-paste example, and an `Accept:` block (the command + expected
   JSON that proves correct usage). Generated skeleton from source + verified
   snippets (`docs-test` runs every fenced snippet in CI).
2. **Root `llms.txt` + `OPERATIONS.md`**: the CLAUDE.md lifecycle (scaffold →
   TDD → register → mount → verify → promote → rollback) rewritten for external
   consumers, each step with its JSON envelope contract and failure recovery.
   This is today's CLAUDE.md content productized — it is the single most
   valuable AI-first asset the repo has.
3. **Queryable surfaces**: JSON Schema exports from `@mvp/contracts`; `--json`
   help on every CLI; the lifecycle MCP server from
   [AI_NATIVE_DEVX.md](AI_NATIVE_DEVX.md) (query_registry, unit graph,
   lifecycle calls) published as `@mvp/mcp` so downstream agents connect
   instead of reading docs at all.

   **Status: implemented.** The MCP server moved from `tools/mcp-devx` to
   `packages/mcp` as a real, buildable `@mvp/mcp` workspace package
   (`package.json`, `tsconfig.json`, `tsdown` build, `bin`) and was verified
   against the current post-P1/P2/P3 repo shape rather than assumed working
   (`query_registry` confirmed to resolve real `registry/registry.data.json`
   fields, unit-tested); the `mount_slot` tool now also covers P2's
   `mount-slot --check` freshness mode.

> **P5-prep status:** `AGENT.md` now exists for the 8 packages whose public API
> is not part of the current refactor (`packages/contracts`, `packages/runtime`,
> `packages/request`, `packages/request-context`, `packages/observability`,
> `packages/optimizer`, `packages/ui`, `packages/design-tokens`), and root
> `docs/OPERATIONS.md` + `llms.txt` are drafted covering the full lifecycle and
> doc index. A future pass just needs to extend `AGENT.md` coverage to the
> remaining packages (`interaction`, `data`, `storage`, `design-system`,
> `trade-client`, the new `domains/*`/`registry`/`store`/`islands` packages)
> once the P1 migration settles their APIs.

Doc pages to write/complete, in priority order: `OPERATIONS.md` (lifecycle),
`COMPOSITION.md` (slots/strategies/streaming semantics incl. the two-tier
independence table), `CONTRACTS.md` (schema index, generated), `INTERACTION.md`
(bus/store/ACL model + orphan-bus warning), `DELIVERY.md` (affected model, what
triggers GLOBAL, deploy gates).

## 8. Phasing, gates, and guardrails

| Phase | Contents | Goal served | Gate |
| --- | --- | --- | --- |
| **P0 Truth & safety** | §3.4 drift check*, §4.1 narrow affected*, §4.2 atomic writes, §3.5 mount-slot hardening, `/render` parse + channel enum + fallback metadata, `isr` rename | A2 A3 A4, B1 | verify green; drift impossible to reintroduce silently |
| **P1 Re-layering** | §2 moves + layering audit + registry into workspace | B2 B3, unblocks npm | zero domain tokens in `packages/`; affected tests updated |
| **P2 Manifest-driven composition** | §3 codegen + `<FragmentSlot>` | **A1** | next fragment mounts with 0 hand edits |
| **P3 Island runtime** | §4.3 handshake + bus unification; C3 go/no-go | C2 (C3?) | skew produces explicit degradation event, not breakage |
| **P4 Rendering** | §4.4 streaming/SSG/PPR; generalized `verify:runtime` wired into `deploy-affected` | C-freshness, A | home streams; runtime gate covers all pages from manifests |
| **P5 Distribution** | §2.3 changesets + publish, §6 demo acceptance, §7 docs + MCP | product | dry-run `npm pack` for all packages; docs-test green; demo matrix complete |

\* already running as spun-off background tasks.

Ordering logic: P0 makes contracts trustworthy so P1/P2 refactors have a net;
P1 before P2 so codegen lands into the final package layout; the C2 handshake
precedes any C3 investment; distribution last because it freezes public APIs.

**Guardrails** (extends plan doc §7):
- No workstream that serves none of 🎯A/B/C.
- Behavior-preserving moves and codegen land as separate PRs from semantic
  changes; every phase ends `pnpm verify` green plus its own gate.
- Do not build the OC-style registry service, multi-runtime support, or a
  visual-diff pipeline in this cycle — they don't block any goal's definition
  of done.
- The demo rule from §6 is absolute: no private framework paths for demos.
