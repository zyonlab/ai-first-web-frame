# AI-Native DevX — Unit Manifest · Lifecycle MCP · Component Dev Harness

> Design doc for making this micro-frontend framework a **parallel-AI-iteration
> base**: many agents each own a unit, develop it in isolation, stay inside
> contract boundaries, and ship only what they touched.
>
> Status: proposal. Framed as **consolidating + closing gaps on capabilities the
> framework already has**, not greenfield. Owner: platform.

## 0. Goal & the friction today

Multiple AI agents (and humans) should be able to extend this system **in
parallel, with low coupling, at high speed**. The bones are already right:

- **Registry-driven composition** — `packages/routes` (`@mvp/routes`) + `shell-gateway`
  compose pages; `packages/registry` (`@mvp/registry`) resolves fragments.
- **Per-unit manifest** — every fragment ships `src/manifest.ts` (name, owner,
  version, renderStrategy, cachePolicy, assets, `dependsOn`, `dataDependencies`,
  `budget`).
- **Frozen contracts** — C1 tokens, C3 store/bus slices (`tradeSliceContracts`),
  C4 data reads, C5 source-id templates (`book.l2.<symbol>`), C9 themes; plus a
  `server-client-boundary` audit and a dependency audit.
- **Deterministic mock data** — `@mvp/data` ships a seeded mock transport, so a
  unit can run without any real backend.
- **Per-unit deploy** — one Dockerfile per fragment, `register-fragment` /
  `mount-slot` / `promote-fragment` / `rollback-fragment` (canary→stable), env
  URL overrides (`ORDER_BOOK_URL`), and **`scripts/affected.mts`** already
  computes affected deployable units from a git diff.

The friction is **the open interface**, not the architecture:

1. The lifecycle is **CLI scripts + hand-edited JSON + tribal knowledge in
   `CLAUDE.md`** — not a declarative surface an agent can query and call.
2. **No isolated component dev.** You bring up the whole stack (or read code) to
   exercise a component that depends on cross-component data/interaction.
3. **`affected` is not wired into verify/deploy** and only knows the original 5
   units, not the trade-demo fragments.
4. **No runtime/visual gate.** Every trade-demo defect this cycle — fragment CSS
   not delivered, React #418, the `ticker.ETH not found` symbol-switch crash,
   layout voids — **passed `pnpm verify` green and was only caught in a browser.**
   Agents can't eyeball; this plane must be machine-checkable.

## 1. Principles

1. **One source of truth per unit** — the manifest. Everything else (registry,
   isolation, affected, MCP schema, docs) is derived from it.
2. **Contract-bounded isolation** — a unit declares what it `consumes` and
   `produces`; an agent cannot break a sibling without tripping a boundary check.
3. **Queryable + callable, not readable** — an agent gets what it needs from
   tools, not by reading `CLAUDE.md`.
4. **Every plane is gated, including runtime** — types/lint/contracts *and* the
   composed runtime/visual behavior.

## 2. The linchpin: extend the unit manifest

The fragment `manifest.ts` is already 80% of a unit manifest. Make it **the**
unit descriptor for every kind of unit and add the two missing facets.

```ts
// The unified shape (superset of today's fragment manifest).
type UnitManifest = {
  name: string;
  kind: "route" | "page" | "component" | "data-source" | "contract";
  owner: string;                 // team/agent that owns it (blast-radius + CODEOWNERS)
  version: string;               // semver; bump gates on contract changes

  // ── dependency graph ──────────────────────────────────────────────
  dependsOn: string[];           // other units (already exists on fragments)
  consumes: {                    // NEW — what it reads from the shared planes
    slices?: string[];           //   C3 store/bus channels it subscribes to
    dataSources?: string[];      //   C5 source-id templates (already: dataDependencies)
    tokens?: string[];           //   C1 token names it reads
  };
  produces: {                    // NEW — what it writes/emits (the coupling surface)
    slices?: string[];           //   C3 channels it publishes (declared owner)
    dataSources?: string[];      //   sources it serves
    events?: string[];
  };

  // ── deploy / runtime ──────────────────────────────────────────────
  renderStrategy?: "static" | "isr" | "cached-ssr" | "dynamic-ssr";
  endpoint?: string;             // "/render" for fragments
  assets?: { js?: string[]; css?: string[] };
  budget: UnitBudget;            // already exists (budget.ts)

  // ── layout contract (NEW — closes the "fragment has no size/shape" gap) ──
  layoutHint?: {
    minHeight?: number;          // px the pane must give it
    aspect?: number;             // preferred w/h, if any
    shape?: "bar" | "ladder" | "table" | "chart" | "panel";
    fills?: boolean;             // true = stretches to fill its pane
  };

  metadata?: Record<string, unknown>;
};
```

Key points:

- **`consumes`/`produces` are the parallel-safety contract.** They are what let
  the dev harness auto-mock a unit's world (§4), what `affected` walks (§5), and
  what a boundary check verifies (§10).
- The manifest is **co-located** with the unit (`src/manifest.ts`) and
  **aggregated** into `packages/registry` / `packages/routes` at register time — that
  aggregate is the queryable graph (§3).
- `layoutHint` is consumed by `mount-slot` (pick a pane that fits) and the
  runtime gate (§6) — it's the machine-readable answer to "the order book is a
  tall ladder, don't put it in an `auto` row."

## 3. Capability A — registry & dependency graph

Derive a single graph from all `UnitManifest`s + the import graph, exposed via
one query surface.

```
query_registry({ kind?, name?, dependents_of?, consumers_of_slice?, produces_slice? })
  → { units: UnitManifest[], edges: {from, to, via}[] }
```

- "What consumes `trade.active-symbol`?" → market-header, chart, order-form,
  realtime layer (this is exactly the map I had to reverse-engineer by hand this
  cycle).
- "What breaks if I change `book.l2.<symbol>`?" → reverse deps.
- Backs both the MCP tool (§7) and a human `pnpm graph` view.

Implementation: extend `tools/release-tools` with a `buildUnitGraph()` over the
registries + `manifest.ts` files; it already reads workspace packages for
`affected`.

## 4. Capability B — single-component dev harness (`dev:component`)

**The answer to "单组件怎么调，尤其跨组件数据/交互怎么调".** Run ONE unit against a
**contract-mocked world** — no full stack.

```
pnpm dev:component order-book            # serve just this fragment + a mock shell
```

The harness reads the unit's manifest and, from `consumes`, **auto-builds its
world**:

1. **Store/bus slices** it consumes → a `createTradeStore(tradeStoreContracts)`
   + `createInteractionBus(tradeSliceContracts)` seeded with each slice's
   contract `initial`. (Both already exist and are cheap.)
2. **Data sources** it consumes (`book.l2.<symbol>`, …) → the existing
   **deterministic mock transport** from `@mvp/data`, self-driving on a timer.
3. **A preview** — the fragment SSR HTML + its client bundle, mounted exactly
   like the real page shell mounts it.
4. **An interaction-injection panel** — the harness renders a side rail of every
   slice/channel the unit `consumes`, with a control to publish an event:
   > “Simulate `TRADE_ORDER_DRAFT_PRICE = 63057.9`” → watch the order-form react.
   > “Publish `TRADE_ACTIVE_SYMBOL = ETH`” → watch the order-book ladder rebuild.

   This makes **cross-component interaction testable in isolation**: you assert
   your unit's response to a contract event without standing up the publisher.
5. **Runtime assertions live** (§6) — console-error/#418 count, computed-style
   spot checks, layout-fit vs `layoutHint`.

Isolation guarantee: the harness only wires the slices/sources the manifest
declares. If a unit reacts to something it didn't `consume`, that's a bug the
harness surfaces (undeclared coupling) — the opposite of the hidden coupling
that made this cycle's symbol-switch bug invisible.

Build on: `@mvp/data` mock transport, `createTradeStore`/`createInteractionBus`,
the fragment's own `/render` + client bundle, `@mvp/assets` for the asset plane.

## 5. Capability C — affected-only verify / build / deploy

`scripts/affected.mts` already computes affected deployable units from a diff.
Finish it:

1. **Extend the unit set** from the original 5 to every fragment + page + shell
   (drive it off the manifest graph, not a hardcoded list).
2. **Walk `consumes`/`dependsOn`** so a change to a contract or a shared package
   marks its *dependents* affected (today it's package-path based only).
3. **Wire into the gate**: `pnpm verify --affected` (typecheck/test/audits only
   the impacted units + dependents) and `pnpm deploy --affected` (rebuild +
   canary only those images; reuse `register`/`promote`/`rollback` + env URL
   override). CI matrix already supported (`toGithubMatrix`).

Result: an agent that touches `order-book` rebuilds one image, not 22.

## 6. Capability D — runtime/visual contract gate (`verify:runtime`)

The missing plane. A headless, per-unit runtime contract run in the harness
(§4) and in a compose smoke, asserting what static checks can't:

- **Hydration** — mounts, `0` console errors, `0` React #418.
- **Delivery** — declared `assets.css` actually reaches the DOM; no `/_next` or
  `/assets` 404s (the CSS-not-delivered + chunk-404 class of bug).
- **Layout fit** — pane void ≈ 0 and no overflow vs `layoutHint` (the 490px
  order-book void class of bug).
- **Interaction** — the unit's declared `consumes` events produce the declared
  DOM effect (the symbol-switch / order-book→order-form class of bug).
- **A11y / computed style** — key tokens resolve, roles present.

Every defect this cycle lands in exactly one of these buckets — and all passed
`pnpm verify`. This gate is what makes an agent's green check trustworthy when
no human eyeballs the result. (See memory: *framework-gap-no-runtime-visual-gate*,
*framework-gap-fragment-layout-contract*.)

## 7. Capability E — expose the lifecycle as MCP tools (+ skills)

The lifecycle scripts **already emit structured `{status, files, error}` JSON** —
they were built to be machine-driven. Wrap them in one MCP server so N agents
drive the whole loop concurrently, no `CLAUDE.md` reading.

| MCP tool | wraps | notes |
|---|---|---|
| `scaffold_component` | `create-component` | PascalCase → 9 files |
| `dev_component` | `dev:component` (§4) | returns preview URL + injection API |
| `verify_unit` | `verify --affected` + `verify:runtime` (§6) | static + runtime |
| `register_fragment` | `register-fragment.mts` | idempotent |
| `mount_slot` | `mount-slot.mts` | uses `layoutHint` to warn on bad pane |
| `query_registry` / `query_contracts` | §3 graph | discovery |
| `deploy_affected` | `affected` + build + `register` | canary only impacted |
| `promote` / `rollback` | promote/rollback scripts | canary→stable, pinned rollback |

- Tool **input schemas = the manifest/args schemas** (already Zod in
  `@mvp/contracts`) — no new schema work.
- Ship the same surface as **slash-command skills** for humans.
- Concurrency: tools are per-unit and idempotent; the registry writes are the
  only shared state — guard with the existing register-script's idempotent
  compare-and-write.

## 8. Worked multi-agent flow

> Agent A: “add a `funding-history` fragment to the trade page.”
> Agent B (parallel): “retheme the market-header.”

1. A: `scaffold_component FundingHistory` → implements against `dev_component`
   (mock `funding.<symbol>` source + injects `TRADE_ACTIVE_SYMBOL`) →
   `verify_unit` (static + runtime) → `register_fragment` → `mount_slot`
   (pane picked via `layoutHint`) → `deploy_affected` (1 new image).
2. B: edits `market-header` tokens → `verify_unit` runtime-checks contrast +
   layout → `deploy_affected` (1 image).
3. They never collide: disjoint `produces`; the boundary check (§10) confirms
   neither changed a contract the other `consumes`. `affected` deploys exactly
   two images.

## 9. Rollout (by ROI) — status

- **Phase 1 ✅ — MCP/skill wrapper + `query_registry`.** `tools/mcp-devx`
  (7 tools, dependency-free stdio) + `pnpm graph` over the unit graph
  (`tools/release-tools/unit-graph.ts`).
- **Phase 2 ✅ — manifest consolidation + graph closure.** `consumes`/`produces`
  (C3 slices) + `layoutHint` on the trade fragments; graph emits slice units +
  `affectedClosure`; `affected_units` MCP tool.
- **Phase 2b ✅ — affected wired to the pipeline.** `pnpm affected:graph`
  (git diff → seed units → closure → deployable images + runtime pages) and
  `pnpm deploy:affected [--runtime]` (rebuild + recreate only affected images,
  then run the runtime gate on affected pages). Shared-root changes fall back to
  a conservative GLOBAL rebuild.
- **Phase 3 ✅ — `dev:component` harness.** `pnpm dev:component <name>` — one
  fragment, themed + `layoutHint`-sized, with its contract-mocked world.
- **Phase 4 ✅ — `verify:runtime` gate.** `pnpm verify:runtime` — hydration /
  asset-delivery / layout-fit / overflow / interaction, on the composed page.

- **Package-dep modeling ✅** — the graph now carries `package` units + a
  `uses-package` edge per `@mvp/*` dependency (read from each unit's + package's
  `package.json`); 15 package units / 143 edges live. A `packages/<x>` change is
  narrowed to just its dependent units (e.g. `@mvp/trade-client` → 5 images, not
  a GLOBAL rebuild). Only `packages/registry/`, `packages/routes/`, and
  repo-root config still fall back to GLOBAL.

- **Mount-time `layoutHint` advisory ✅** — `mount-slot` now reads the mounted
  fragment's `layoutHint` and emits the layout contract as `warnings` (fills →
  "put it in a stretching cell, not an auto row"; `minHeight`; aspect). The cheap
  static counterpart to the runtime `layout-fit` check — it flags the 490px-void
  class at wire time. Pure `layoutAdvisories()`, unit-tested.

Remaining refinements: the interactive `dev:component` drive (needs a client
bundler); and wiring `verify:runtime` into the CLAUDE.md acceptance flow.

Each phase is independently shippable and valuable.

## 10. Why this stays low-coupling (the firewall)

Parallel agents are safe only if one can't silently break another. The
enforcement chain:

- **Declared contracts** — C1/C3/C4/C5/C9 are frozen; the `symbol-switcher`
  publisher pin is a live example (it rejected a wrong-owner publish this cycle).
- **`consumes`/`produces` on the manifest** — the machine-readable coupling map.
- **Boundary check (extend the existing `server-client-boundary` audit)** —
  fails when a unit changes a `produces` contract without a version bump, or
  reads a slice it didn't `consume`. An agent gets *immediate* feedback instead
  of breaking a sibling at runtime.
- **`verify:runtime`** — catches the coupling bugs that are only visible when
  units actually run together.

Net: the framework already decomposes, contracts, mocks, and deploys per unit.
This doc **收口** those into *one manifest → a graph, an isolated dev harness, an
affected pipeline, a runtime gate, and an MCP surface* — turning the fragmented
micro-component system into a genuinely parallel, low-coupling AI iteration base.

---

### Appendix — first concrete PRs

1. `tools/release-tools/buildUnitGraph()` + `query_registry` (Phase 1/3 shared).
2. `packages/mcp-devx` — MCP server wrapping the 8 lifecycle scripts (Phase 1).
3. `manifest.ts` schema bump: `consumes`/`produces`/`layoutHint` + a codemod to
   backfill from existing `dataDependencies` + island `bus.subscribe` sites.
4. `scripts/dev-component.mts` + `apps/_harness` mock shell (Phase 3).
5. `scripts/verify-runtime.mts` (playwright over the harness + compose smoke).
