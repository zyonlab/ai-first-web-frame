# AI Agent Operations Manual

pnpm monorepo for an AI-native micro-frontend framework. Shell gateway (4100) composes pages
(page-home 4101, page-product 4102) which fetch SSR fragments (4201+) via `@mvp/registry`.

## Hard rules

- pnpm only. Never npm, npx, or yarn. Run tools via `pnpm exec <tool>` or `pnpm --filter <pkg> <script>`.
- Tests: Vitest (root config `vitest.config.ts`). Contracts: Zod schemas in `@mvp/contracts` (`packages/contracts/src/index.ts`).
- Typecheck is `pnpm typecheck` (tsgo, per-project tsconfigs). Builds use tsdown (packages/fragments) or next build (pages).
- No bare `fetch(...)` in business code — use `@mvp/request` / `@mvp/data` (dependency-audit fails otherwise).
- Performance budgets are hard gates: exceeding component/fragment/page budgets fails `pnpm verify`.
- New code and comments in English; formatting via biome (2 spaces). `pnpm check` must pass.
- Registry/manifest edits go through the scripts below, not hand-editing JSON.

## Directory map

- `apps/` — shell-gateway, page-home, page-product (Next.js pages; slots data in `src/manifest.slots.json`)
- `fragments/` — SSR fragment services (fastify, one Dockerfile each)
- `packages/` — `@mvp/*` libraries (contracts, runtime, data, request, ui, observability, optimizer, registry,
  routes, ...); `@mvp/registry` (fragment registry) and `@mvp/routes` (route registry) are real workspace packages
- `registry/` — fragment/route registry runtime state, not package source: `registry/registry.data.json` and
  release history `registry/releases.json`, loaded by `@mvp/registry` via an explicit repo-root-relative path
- `tools/` — audits + `create-component` scaffolder; `scripts/` — repo-level CLIs (tsx); `infra/docker/` — compose

## Fragment lifecycle (end to end)

1. **Scaffold** (PascalCase name; creates `fragments/<kebab-name>/` with 9 files):
   `pnpm --filter @mvp/create-component start -- PricePanel --type fragment`
   Accept: JSON output has `"status": "created"`.
2. **Implement + test (TDD)**: edit `fragments/price-panel/src/render.tsx`, extend `render.test.tsx` first.
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
5. **Verify** the whole repo (typecheck, lint, format, tests, build, 6 audits; writes `reports/`):
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

## Common commands

- `pnpm test` (all) | `pnpm --filter @mvp/page-home test` (one package)
- `pnpm exec vitest run packages/registry` (registry + lifecycle helper tests)
- `pnpm typecheck` | `pnpm lint` | `pnpm check` | `pnpm build`
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
- Typecheck fails in an unrelated package: fix only your own files; report pre-existing failures instead of patching other packages.
