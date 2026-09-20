# AI Agent Operations Manual

pnpm monorepo for an AI-native micro-frontend framework. Shell gateway (4100) composes 7 pages
(home 4101, product 4102, trade 4103, markets 4104, portfolio 4105, vaults 4106, referrals 4107)
which fetch SSR fragments (14 services, 4201-4214) via `@mvp/registry`.

## Hard rules

- pnpm only. Never npm, npx, or yarn. Run tools via `pnpm exec <tool>` or `pnpm --filter <pkg> <script>`.
- Tests: Vitest (root config `vitest.config.ts`). Contracts: Zod schemas in `@mvp/contracts` (`packages/contracts/src/index.ts`).
- Typecheck is `pnpm typecheck` (tsgo, per-project tsconfigs). Builds use tsdown (packages/fragments) or next build (pages).
- React **19.3** on Next **15.3** (a single declared range repo-wide — `audit:deps`'
  `duplicated-package-version` rule fails on a peer/dep range split). React 19 hoists
  `<title>`/`<meta>`/`<link>` from anywhere in the tree into `<head>`, so do not
  reintroduce React-18-era workarounds for that; the page-health marker stays a
  `<div hidden>` on purpose (it is a gateway signal, not document metadata).
- No bare `fetch(...)` in business code — use `@mvp/request` / `@mvp/data` (dependency-audit fails otherwise).
- Performance budgets are hard gates: exceeding component/fragment/page budgets fails `pnpm verify`.
- New code and comments in English; formatting via biome (2 spaces). `pnpm check` must pass.
- Registry/manifest edits go through the scripts below, not hand-editing JSON.

## Directory map

- `apps/` — shell-gateway + 7 Next.js pages (page-home, page-product, page-trade, page-markets,
  page-portfolio, page-vaults, page-referrals; slots data in `src/manifest.slots.json`)
- `fragments/` — 14 SSR fragment services (fastify, one Dockerfile each)
- `domains/` — trade demo domain layer (trade-contracts, trade-data, trade-prefs, trade-theme,
  trade-chart); import rule is three-layer: apps/fragments → domains → packages, never upward
- `packages/` — `@mvp/*` libraries (contracts, runtime, data, request, ui, observability, optimizer, registry,
  routes, ...); `@mvp/registry` (fragment registry) and `@mvp/routes` (route registry) are real workspace packages.
  `@mvp/fragment-host` is the one HTTP host all 14 fragment services run on — routes, metrics and trace
  export live there, not in each `fragments/*/src/server.ts`
- `registry/` — fragment/route registry runtime state, not package source: `registry/registry.data.json` and
  release history `registry/releases.json`, loaded by `@mvp/registry` via an explicit repo-root-relative path
- `tools/` — audits + `create-component` scaffolder; `scripts/` — repo-level CLIs (tsx); `infra/docker/` — compose;
  `e2e/` — Playwright specs (shell/product/fragments/no-js/trade-hydration) + `e2e/unit/` for repo-level
  logic with no owning package
- `docs/reports/` — hand-written long-form HTML reports on the repo itself (architecture map, cost/risk
  assessment) + their index. Read them with `pnpm reports`. Distinct from the repo-root `reports/`, which is
  machine-generated audit output rewritten by every `pnpm verify`

Every `packages/*` and `domains/*` package ships an `AGENT.md` whose fenced ts/tsx snippets are
EXECUTED by `docs:test` inside `pnpm verify` — editing an AGENT.md example into something that
doesn't run fails CI.

## Fragment lifecycle (end to end)

1. **Scaffold** (PascalCase name; creates `fragments/<kebab-name>/` with 11 files):
   `pnpm --filter @mvp/create-component start -- PricePanel --type fragment`
   Accept: JSON output has `"status": "created"` and `files.length === 11`.
   The generated unit **runs as scaffolded**: `src/server.ts` is a ~20-line adapter over
   `@mvp/fragment-host` (which owns `GET /` · `/health` · `/ready` · `/metrics` · `/manifest` ·
   `/assets` · `/budget` · `POST /render`), the port is allocated from the first free value
   after 4201, and the Dockerfile actually builds. Never hand-roll a fragment server —
   `audit:deps`' `fragment-server-not-hosted` rule fails the build.
2. **Implement + test (TDD)**: edit `fragments/price-panel/src/render.ts`, extend `render.test.ts` first.
   `pnpm --filter @mvp/fragment-price-panel test`
   Accept: all tests green.
3. **Register** into the fragment registry (and optionally docker-compose; fragment host ports start at 4201,
   the script scans used ports and allocates the next free one unless `--port` is given):
   `pnpm exec tsx scripts/register-fragment.mts --name price-panel --version 0.1.0 --service-url http://localhost:4203 --channel canary --with-compose`
   Accept: `"status": "registered"`; rerun prints `"action": "unchanged"` (idempotent).
   Env override convention: `PRICE_PANEL_URL` rewrites serviceUrl/manifestUrl at runtime.
4. **Mount** the fragment into a page manifest slot:
   `pnpm exec tsx scripts/mount-slot.mts --page page-home --slot pricePanel --fragment price-panel --strategy dynamic-ssr --channel canary --timeout-ms 200 [--props <json>] [--cache-policy <json>] [--data-dependencies <json-array>] [--static-html <string>] [--required]`
   Accept: `"status": "mounted"` and empty `warnings`. Unmount with `--remove` instead of `--fragment ...`.
   Mounting a fragment that is not in the fragment registry fails (`"status": "failed"`, no write);
   register it first, or pass `--allow-unregistered` to warn-and-proceed (`--remove` is unaffected).
   **Status: codegen rolled out to all five pages (P2).** For every page, `mount-slot` now also
   regenerates `src/fragmentSlots.gen.ts` (a `FragmentSlotDefinition[]` built straight from
   `manifest.slots.json`) after every successful mount/unmount — no hand-editing
   `fragmentSlots.ts`'s slot array. Run `mount-slot --page <page> --check` (writes nothing) to
   verify the gen file is still in sync; `pnpm verify:manifest-gen` runs this for every page and
   is wired into `pnpm verify`. Each page's `fragmentSlots.ts` is now a thin wrapper around the
   generated array (only per-request glue — `timeoutMs` overrides, `resolveData`, and for
   `page-trade`'s per-request `props.symbol` a `{...slot, timeoutMs, props}` merge — stays
   hand-written) and each `page.tsx` renders slots via `<FragmentSlot>` from `@mvp/runtime/react`.
   `page-product`'s `reserved: true` `price-panel` slot is intentionally excluded from codegen
   and stays hand-rendered, by design.
   `pnpm test`/`pnpm verify` still also run each page's `tests/manifestSync.test.ts`
   (`diffManifestAgainstRuntime` from `@mvp/registry`'s `packages/registry/src/slots.ts`) as a
   belt-and-suspenders check, though `--check`/`verify:manifest-gen` now makes manifest↔runtime
   drift structurally impossible rather than merely detected.
5. **Verify** the whole repo (14 gates: typecheck, lint, check, verify:manifest-gen, verify:demos
   (docs/DEMOS.md generated block in sync with each page manifest's `demonstrates`), docs:test,
   test, build, 6 audits; writes `reports/`):
   `pnpm verify`
   Accept: exit 0. Never ship with a failing audit or budget.
6. **Promote** canary -> stable (records previous stable in `versions` history + appends to `releases.json`):
   `pnpm exec tsx scripts/promote-fragment.mts --name price-panel`
   Accept: `"status": "promoted"`, `from`/`to` versions correct.
7. **Rollback** stable to the version recorded at promote time (or an explicit pinned version):
   `pnpm exec tsx scripts/rollback-fragment.mts --name price-panel [--to 0.1.0]`
   Accept: `"status": "rolled-back"`. Fails cleanly when no rollback target is recorded.

All four scripts print structured JSON (`status`/`files`/`error`) and exit 1 on failure without writing files.
Writes are atomic (temp file + rename) behind a `<file>.lock` advisory lock with an optimistic content-hash
check: if another agent changed the file since load, the script prints `{"status": "conflict", "retry": true}`
and exits 1 without writing — just rerun the same command.

## Fragment backend proxy + page health

- A fragment declares `proxy: { <target>: "<absolute backend url>" }` in its
  `src/manifest.ts`; the shell gateway mounts it at `/_fragment/<fragment>/<target>/*`
  on the public origin. That is the channel a hydrated island uses to reach its own
  backend — same origin, no CORS, and the fragment's `serviceUrl` never reaches the
  browser. Pure resolution logic in `packages/runtime/src/fragmentProxy.ts`; the
  declared base is the boundary (a remainder that would escape it is rejected).
- Composed pages render `<PageHealthMeta>` / `<PageHealthMetaStream>` from
  `@mvp/runtime/react`. The gateway maps a `health: "unhealthy"` marker (a **required**
  slot failed) to `503` + `Retry-After` while still returning the body unchanged;
  `degraded` stays `200`. `SHELL_REQUIRED_FAILURE_STATUS=0` disables it.
- Custom request-context dimensions go through `createRequestContext({ extensions })`
  (`ctx.extensions`, propagated as `x-mvp-ctx-<name>`), NOT by widening
  `RequestContextSchema` — that keeps business vocabulary out of the framework package.

## Realtime subscriptions (fragment-declared)

- A live, non-React panel declares its own feeds in `src/manifest.ts` as source-id
  **templates**: `subscriptions: ["book.l2.<symbol>"]`. Separate from
  `dataDependencies` (what SSR reads once) — a fragment can read a source at render
  time without holding it open in the browser. `GET /manifest` publishes it, so a
  new fragment version can change what it listens to and ship on its own.
- The fragment ships the browser half from a `./live` export: a `LivePanel`
  (`fragment`, `subscriptions` passed straight from the manifest,
  `mount(ctx) -> { onFrame, stop? }`). See `fragments/order-book/src/live.ts`.
- The page contributes only the panel list (`TRADE_LIVE_PANELS` in
  `apps/page-trade/src/realtime.ts`, the non-React counterpart of the island
  registry), the parameter values, and a `subscribe` adapter onto its data client.
  `startLivePanels` from `@mvp/runtime/live` does discovery, resolution,
  re-subscribe and teardown generically — do NOT add per-fragment wiring to a page.
- `ctx.remounted` is `true` only when a parameter THAT PANEL binds changed; that is
  how a panel knows its SSR rows went stale. A parameter-free source (`positions`)
  keeps its rows across a symbol switch.
- `apps/page-trade/src/liveContract.test.ts` fails the build if a panel declares a
  template that does not resolve to a known source id, or binds a parameter the
  page cannot supply (which would mount a panel that never receives a frame).

## Minimum deployable unit

A fragment is the smallest unit that ships on its own, and that is an executable claim:

- `pnpm verify:unit --name <fragment>` builds only that unit's closure
  (`pnpm --filter @mvp/fragment-<name>... build` → `dist/server.js`), boots the artifact,
  and asserts `/health` + `/ready` + `/manifest` all report the same manifest **version**
  and that `POST /render`-backed output carries it. JSON envelope, exit 0 only when every
  step passed.
- One Dockerfile per fragment (`fragments/<name>/Dockerfile`, `EXPOSE <port>`), so any
  image registry / orchestrator can build and run it — deployment itself is deliberately
  not implemented here.
- **Going live with a new version** needs no page rebuild: deploy the image, then
  `register-fragment` the new version on `canary` and `promote-fragment` it to `stable`.
  Pages resolve `serviceUrl`/version from `registry/registry.data.json` per request, and
  `<FRAGMENT_NAME>_URL` overrides the target at runtime without a registry write.
  Because `/health` reports the deployed version, a rollout can verify WHICH build answered
  before promoting it, and `rollback-fragment` restores the previously promoted version.

## Common commands

- `pnpm test` (all) | `pnpm --filter @mvp/page-home test` (one package)
- **Task caching**: `build` and `test` run through Turborepo (`turbo.json`). A warm tree
  takes `pnpm verify` from ~165s to ~32s (build 100s → 0.2s, test 24s → 0.2s); turbo also
  restores deleted `dist/`/`.next/` from cache instead of rebuilding. Two correctness rules
  when touching it:
  - Anything a task reads from OUTSIDE its own package must be declared, or the cache
    serves a stale pass. `packages/mcp/turbo.json` is the worked example: its tests read the
    registry data and page manifests, so those are listed as `$TURBO_ROOT$` inputs.
  - Env vars that change what a task does belong in `globalEnv`; values that only address an
    external environment (`*_URL`, secrets) belong in `globalPassThroughEnv` so they never
    enter a cache key. Biome's `noUndeclaredEnvVars` enforces this once `turbo.json` exists.
- `pnpm test` / `verify:manifest-gen` / `docs:test` self-heal a cold clone: they run
  `scripts/ensure-workspace-build.mts` first. It ALWAYS delegates to turbo rather than
  skipping when `dist/` merely exists — a present-but-stale `dist/` is exactly the failure
  that check used to let through. It is needed even with turbo because `^build` covers only
  DECLARED deps, and `@mvp/mcp` declares none while its tests shell out to `scripts/*.mts`.
- `pnpm exec vitest run packages/registry` (registry + lifecycle helper tests)
- `pnpm typecheck` | `pnpm lint` | `pnpm check` | `pnpm build`
- `pnpm verify:unit --name <fragment>` (single-unit build + boot + version contract)
- `pnpm reports [--port n] [--open]` (serve `docs/reports/` — zero-dependency read-only static server)
- `pnpm docs:serve [--port n] [--open]` (serve `website/docs/` — the outward-facing docs, Markdown rendered on request)
- `docker compose -f infra/docker/docker-compose.yml config` (validate compose after registration)

## Failure recovery

- Script prints `"status": "failed"`: read `error`, fix the input; no files were changed.
- Bad registry state: registry entries live in `registry/registry.data.json`
  (Zod-validated on load by `FragmentRegistrySchema`); re-run `register-fragment` with correct values,
  or roll back via `rollback-fragment`. History is append-only in `registry/releases.json`.
- Wrong slot mounted: `pnpm exec tsx scripts/mount-slot.mts --page <page> --slot <name> --remove`.
- Duplicate compose service/port: the script refuses used ports; pass an explicit free `--port`.
- Budget failure in verify: shrink JS/CSS or split the fragment; budgets are in each unit's `budget.ts`.
- Similarity audit failure: reuse the flagged existing component instead of adding a near-duplicate.
- `layer-constraint-violation`: layering is declarative in `dependency-audit.json`
  (`tags` + `depConstraints`, modelled on `@nx/enforce-module-boundaries`). Fix the import,
  or change the constraint deliberately — do not add a tag to dodge it.
- Typecheck fails in an unrelated package: fix only your own files; report pre-existing failures instead of patching other packages.
