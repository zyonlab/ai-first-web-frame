# Architecture Refactor Plan — Goals-First, Production-Ready, npm-Distributable

> Last updated: 2026-07-09. Status: plan of record for the refactor cycle.
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
**Two decisions are explicitly left to the repo owner, not made here:**
(1) `"license": "UNLICENSED"` is a placeholder on all 17 packages — this repo
has no LICENSE file and never had a license field before; picking a real
open-source license is a business decision this task did not make on the
owner's behalf. (2) No `publishConfig` (registry/access) was added to any
package — access/registry configuration is deferred alongside the license
choice. `tools/release-tools` and `tools/mcp-devx` (§7.3's future `@mvp/mcp`)
are unaffected by this pass — both stay `private: true`/unbuilt, tracked as
a separate increment per the parallel MCP-packaging task. Also noted in
passing, not acted on: `packages/ui`'s `exports` map still points
`./shadcn/globals.css` at `./src/shadcn/globals.css`, which is outside the
new `files` allow-list — that subpath export would 404 for a real npm
consumer until either the CSS file moves under `dist/` or `files` grows a
`src/shadcn/globals.css` entry; and `packages/assets`/`packages/workers`
exist as unmarked-private workspace packages not mentioned by this plan's
publish/not-published lists, so they were left untouched by both the
`package.json` changes and the changesets `ignore` list.

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
(In progress as a spun-off task.) Converge the legacy `affected.mts` onto the
graph implementation — one affected engine.

**Status: implemented.** `tools/release-tools/src/affected-graph.ts` now diffs
`platform/fragment-registry/src/registry.data.json` and
`platform/fragment-registry/releases.json` content (base ref vs. head/working
tree, via a `getRegistryFileContent` reader the CLI wires to `git show`) and
seeds only the fragment(s) that actually changed — added, removed, or with a
channel/version/serviceUrl edit — falling back to GLOBAL on any malformed or
unreadable content. Every other `platform/**` path (registry/mutation code,
route-registry) is unchanged and still GLOBAL. The legacy `scripts/affected.mts`
engine was inspected but left alone: it already scopes `platform/fragment-registry/`
per-unit via `extraPathPrefixes` rather than one blunt global flag and has no
page→fragment mount model, so mirroring this fix there is a structurally
different job than converging the two engines — left as the still-open
follow-up noted above.

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

**Status: implemented (items 1–2; item 3 remains out of scope this phase).**
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

**Status: items 2–3 implemented, piloted on page-home only (item 1 — the
`isr` → `ttl-cache` rename — is out of scope for this phase, already tracked
as a separate low-value cosmetic follow-up).**

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
| Nx | affected task graph | **Already adapted**; converge the two implementations | §4.1 |
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
