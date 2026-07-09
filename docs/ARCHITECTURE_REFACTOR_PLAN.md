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

## 4. Delivery plane (🎯B, 🎯C)

### 4.1 Narrow affected for registry writes
Special-case `registry.data.json` / `releases.json` diffs in `seedsFromPaths`:
parse changed fragment names, seed only those units (dependent pages come from
the existing closure). Code changes under `packages/registry` src stay GLOBAL.
(In progress as a spun-off task.) Converge the legacy `affected.mts` onto the
graph implementation — one affected engine.

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
