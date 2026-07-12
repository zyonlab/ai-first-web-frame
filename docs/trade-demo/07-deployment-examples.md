# 07 — Deployment Examples (single-component + single-page)

> Anchored to the [master-plan spine](README.md). This doc details **§9 Deployment
> examples** (both required) and maps each step to scripts and infra that already
> exist in this repo. When anything here conflicts with the spine, the spine wins
> until amended there.

This is a **runbook**: every step is a copy-pasteable command plus its acceptance
criterion, the exact files that change, and the failure-recovery move. Two flows:

1. **Single-component (fragment) independent deploy** — ship the `order-book`
   fragment on its own, without redeploying the trade page or any other fragment.
2. **Single-page independent deploy** — ship the `/markets` page (`page-markets`)
   on its own, without touching `page-trade`.

Both flows reuse the existing lifecycle scripts, the affected-matrix CI, the
docker-smoke check, and the Argo canary skeleton. Each flow ends with an
explicit **"implemented vs. needs-补" (gap)** subsection so you know exactly
where the paved road ends.

---

## 0. Prerequisites and mental model

| Concept | Where it lives | Behavior |
| --- | --- | --- |
| Fragment channels | `registry/registry.data.json` | Each fragment has `stable` / `canary` / `preview` entries + a `versions` history map. `resolveFragment(name, channel)` picks the URL/version. |
| Fragment env override | `fragmentEnvVarName(name)` in `packages/registry/src/registry.ts` | `order-book` → env var **`ORDER_BOOK_URL`**; when set it rewrites `serviceUrl`/`manifestUrl` at runtime (compose, k8s) without touching the registry JSON. |
| Page → fragment binding | `apps/<page>/src/manifest.slots.json` | Each slot pins `{ fragment, channel, strategy, timeoutMs }`. The page resolves the fragment through the registry **by the slot's `channel`** at request time. |
| Route channels | `packages/routes/src/registry.ts` | Each `RouteEntry` has `id/path/page/serviceUrl/channel`. Pages are matched by `matchRoute(pathname)`; `serviceUrl` is overridable via `process.env.<PAGE>_URL`. |
| Release history | `registry/releases.json` | Append-only; `promote`/`rollback` push a record here. |
| Affected units | `tools/release-tools/src/affected.ts` (`DEPLOYABLE_UNITS`) | Git-diff + pnpm graph → which images rebuild. **New units must be registered here** (see gaps). |

**Channel routing in one sentence:** the page reads its slot's `channel`
(`canary`/`stable`), calls `resolveFragment("order-book", channel)`, and gets the
URL for that channel — so flipping a slot from `canary` to `stable`, or promoting
the fragment so `stable` points at the new version, changes what the page serves
**without redeploying the page**.

---

## Example 1 — Single component: ship the `order-book` fragment independently

Goal: introduce a brand-new realtime fragment, get it live on the `page-trade`
order-book slot via the **canary** channel, verify, then promote it to **stable**
and (if needed) roll it back — all without redeploying `page-trade` or any sibling
fragment.

### Step 1.1 — Scaffold

```bash
pnpm --filter @mvp/create-component start -- OrderBook --type fragment
```

- **Accept:** JSON output has `"status": "created"`.
- **Creates** `fragments/order-book/` with 9 files: `src/server.ts`,
  `src/render.tsx`, `src/manifest.ts`, `src/budget.ts`, `src/fixtures.ts`,
  `src/render.test.tsx`, `package.json`, `Dockerfile`, `README.md`.
- **No registry/manifest change yet** — scaffolding only writes the fragment dir.

### Step 1.2 — Implement + test (TDD)

Extend the test first, then implement the SSR render. Per the spine (§5), the
order book is **realtime, patch-only**: SSR renders the initial ladder snapshot;
the island patches rows via `subscribeData`, it does not re-render a Radix tree.

```bash
# edit fragments/order-book/src/render.test.tsx  (assert bid/ask ladder, spread, depth bars)
# edit fragments/order-book/src/render.tsx        (SSR ladder + token-based CSS, no React shipped)
# edit fragments/order-book/src/budget.ts         (JS/CSS budget; keep SSR panel tiny)
pnpm --filter @mvp/fragment-order-book test
```

- **Accept:** all tests green.
- **Contract:** the render output shape (`html` + `assets.{js,css}` + `cache` +
  `metadata`) is validated downstream; realtime data goes through `@mvp/data`
  (`subscribeData`) — **no bare `fetch`** (dependency-audit fails otherwise).
- **Island bundling:** the interactive patch runtime mounts through
  `@mvp/trade-client`; `order-book` declares it as a shared dependency (via
  `@mvp/assets`) instead of re-bundling React.

### Step 1.3 — Register into the fragment registry (canary, auto port, compose)

```bash
pnpm exec tsx scripts/register-fragment.mts \
  --name order-book \
  --version 0.1.0 \
  --service-url http://localhost:4203 \
  --channel canary \
  --with-compose
```

- **Accept:** `"status": "registered"`, `"action": "added"`, and a
  `"compose": { "service": "order-book", "port": 4203, "action": "added" }`
  block. Re-running prints `"action": "unchanged"` (idempotent).
- **Port allocation:** if you omit the port in `--service-url` (or pass no
  `--port`), the script scans `docker-compose.yml` host ports and picks the next
  free one from 4201 (`nextFragmentPort`). It **refuses a port already in use**.
- **Files changed:**
  - `registry/registry.data.json` — adds
    ```json
    "order-book": {
      "canary": { "version": "0.1.0",
                  "serviceUrl": "http://localhost:4203",
                  "manifestUrl": "http://localhost:4203/manifest" },
      "versions": { "0.1.0": { ... } }
    }
    ```
  - `infra/docker/docker-compose.yml` — appends an `order-book` service on
    `4203:4203` with `PORT: "4203"`.
- **Env override convention:** the runtime env var is **`ORDER_BOOK_URL`**
  (`fragmentEnvVarName("order-book")`). Set it to point compose/k8s at the real
  service host; it rewrites `serviceUrl`/`manifestUrl` without editing the JSON.

### Step 1.4 — Mount into the trade page's order-book slot (canary)

```bash
pnpm exec tsx scripts/mount-slot.mts \
  --page page-trade \
  --slot orderBook \
  --fragment order-book \
  --strategy dynamic-ssr \
  --channel canary \
  --timeout-ms 200
```

- **Accept:** `"status": "mounted"`, `"action": "added"`, and **empty
  `warnings`** (a non-empty warning means the fragment isn't in the registry —
  go back to Step 1.3).
- **Files changed:** `apps/page-trade/src/manifest.slots.json` gains
  ```json
  { "name": "orderBook", "fragment": "order-book", "channel": "canary",
    "strategy": "dynamic-ssr", "timeoutMs": 200, "required": false }
  ```
- **Channel routing effect:** with `channel: "canary"`, `page-trade` resolves the
  order-book fragment through `resolveFragment("order-book", "canary")` → the
  `4203` canary URL. Stable traffic paths that pin `channel: "stable"` are
  unaffected because there is no `stable` entry yet.
- **Then wire the slot** into `apps/page-trade/src/fragmentSlots.ts` (add
  `orderBook` to the fetch list) and extend the page tests. (This is app code,
  not a script — mirror the existing slots in `page-home`.)
- **Unmount** (mistake recovery): `mount-slot --page page-trade --slot orderBook --remove`.

### Step 1.5 — Verify the whole repo

```bash
pnpm verify
```

- **Accept:** exit 0. Runs typecheck, lint, format, tests, build, and 6 audits;
  writes `reports/`. **Budgets are hard gates** — if the order-book JS/CSS
  exceeds its `budget.ts`, shrink the panel or split it. **Similarity audit** —
  if it flags a near-duplicate of an existing fragment, reuse that instead.

### Step 1.6 — Build + smoke the fragment in the compose stack

```bash
docker compose -f infra/docker/docker-compose.yml build --provenance=false --sbom=false order-book
docker compose -f infra/docker/docker-compose.yml up -d --no-build
pnpm exec tsx scripts/docker-smoke.mts --timeout 180
```

- **Accept:** docker-smoke JSON has `"ok": true`. It polls `/health` on the
  Fastify fragments and the composed shell routes.
- **Gap closed:** `docker-smoke` uses `createDefaultSmokeChecks` in
  `tools/release-tools/src/smoke.ts`, which now DERIVES its check list from
  the fragment registry (`registry/registry.data.json`) and the route
  registry (`packages/routes/src/registry.ts`). Registering `order-book`
  automatically adds its `/health` check (and `page-trade` is covered via
  its route) — no hand-editing of the check list.

### Step 1.7 — Promote canary → stable

Once the canary slot has soaked, promote:

```bash
pnpm exec tsx scripts/promote-fragment.mts --name order-book
```

- **Accept:** `"status": "promoted"`, with `from`/`to` versions correct
  (`from` = previous stable, absent on first promote; `to` = `0.1.0`).
- **Files changed:**
  - `registry.data.json` — copies the `canary` entry into `stable`, records the
    previous stable in `versions` history.
  - `releases.json` — appends a release record (append-only history).
- **Channel routing effect:** any slot pinned `channel: "stable"` now resolves
  order-book `0.1.0`. To actually serve stable to trade users, flip the slot:
  `mount-slot --page page-trade --slot orderBook --fragment order-book --channel stable ...`
  (this edits only `manifest.slots.json`; **no page redeploy of code**, the page
  re-resolves the channel at request time).

### Step 1.8 — Rollback

```bash
pnpm exec tsx scripts/rollback-fragment.mts --name order-book            # to recorded rollback target
pnpm exec tsx scripts/rollback-fragment.mts --name order-book --to 0.1.0 # to an explicit pinned version
```

- **Accept:** `"status": "rolled-back"`, `from`/`to` correct. **Fails cleanly**
  (`"status": "failed"`, no files written) when there is no rollback target
  recorded and no `--to` given.
- **Files changed:** `registry.data.json` (stable pointer moves) + `releases.json`
  (appends the rollback record).

### Example-1 failure recovery

| Symptom | Fix |
| --- | --- |
| `mount-slot` warning `fragment ... not in registry` | Run Step 1.3 first (register) before mounting. |
| `register-fragment` → `host port N is already used` | Pass a free `--port`, or let it auto-scan by omitting the port. |
| `pnpm verify` budget failure | Shrink JS/CSS or split the fragment; budgets in `fragments/order-book/src/budget.ts`. |
| Similarity-audit failure | Reuse the flagged existing fragment instead of adding a near-duplicate. |
| Bad registry state | Re-run `register-fragment` with correct values, or `rollback-fragment`. History stays append-only in `releases.json`. |
| Wrong slot mounted | `mount-slot --page page-trade --slot orderBook --remove`. |
| `promote`/`rollback` prints `"status": "failed"` | Read `error`; no files were changed. Fix input and retry. |

### Example 1 — implemented vs. needs-补

| Piece | Status |
| --- | --- |
| `create-component`, `register-fragment`, `mount-slot`, `promote-fragment`, `rollback-fragment` | **Implemented** — used as-is. |
| Registry channel resolution + `versions` history + `ORDER_BOOK_URL` override | **Implemented** in `registry.ts`. |
| Compose service auto-add + port scan | **Implemented** in `compose.ts`. |
| `page-trade` app + `orderBook` slot + `fragmentSlots.ts` wiring | **需补** — page-trade does not exist yet (built in the parallel plan, [10](10-parallel-work-plan.md)). `mount-slot` requires `apps/page-trade/src/manifest.slots.json` to exist. |
| `order-book` in `DEPLOYABLE_UNITS` + smoke checks | **需补** — add it to `tools/release-tools/src/affected.ts` and `smoke.ts` so CI builds/smokes it independently. |
| Argo canary for a **fragment** | **需补** — the existing rollout skeleton targets `page-product` only (see Example 2 / §Canary). |

---

## Example 2 — Single page: ship `/markets` (`page-markets`) independently

Goal: ship the `/markets` list page as its own release — new app unit, a
route-registry entry on the **canary** channel, its own image built by the
affected matrix, smoked, then promoted to **stable** and rollback-able — **without
rebuilding or redeploying `page-trade`**.

### Step 2.1 — Create the page unit

Scaffold `apps/page-markets` as a Next.js page app modeled on `apps/page-product`:

```
apps/page-markets/
  src/manifest.slots.json      # markets-table slot (+ any fragments)
  src/fragmentSlots.ts         # slot fetch list
  package.json                 # name "@mvp/page-markets", workspace deps
  Dockerfile                   # mirror apps/page-product/Dockerfile, PORT 4104
  next.config / tsconfig ...
```

- **Accept:** `pnpm --filter @mvp/page-markets build` and `test` green.
- **Port:** 4104 (per spine §2). Mount the `markets-table` fragment into the page
  the same way as Example 1 (`register-fragment` markets-table → `mount-slot
  --page page-markets --slot marketsTable ...`).

### Step 2.2 — Add the route-registry entry (canary)

Add a `RouteEntry` to `packages/routes/src/registry.ts`:

```ts
{
  id: "markets",
  path: "/markets",
  page: "@mvp/page-markets",
  serviceUrl: process.env.PAGE_MARKETS_URL ?? "http://localhost:4104",
  channel: "canary",
},
```

- **Accept:** `validateRouteRegistry(routeRegistry)` returns `true` (id string,
  path starts `/`, page starts `@mvp/`, serviceUrl `http`, channel in the set).
  `matchRoute("/markets")` returns this entry.
- **Independence:** existing `home`/`product` (and future `trade`) routes are
  untouched — the shell composes each route by its own entry, so a `canary`
  `/markets` does not affect stable `/trade`.
- **Env override:** `PAGE_MARKETS_URL` retargets the page host at runtime
  (compose/k8s), same pattern as `PAGE_HOME_URL` / `PAGE_PRODUCT_URL`.

### Step 2.3 — Infra: Dockerfile, compose, k8s

- **Dockerfile:** `apps/page-markets/Dockerfile`, mirror `page-product` (build +
  `PORT=4104`).
- **docker-compose:** add a `page-markets` service (`4104:4104`,
  `PAGE_MARKETS_URL`/fragment URLs), and add it to the shell-gateway env so the
  shell can reach it.
- **k8s:** add `infra/k8s/page-markets.yaml` (Deployment + Service on 4104,
  probing `/` until it exposes `/health`), then register it in
  `infra/k8s/kustomization.yaml` `resources:` + `images:` (default `newTag: dev`).
- **Accept:** `docker compose -f infra/docker/docker-compose.yml config` parses;
  `kubectl kustomize infra/k8s` renders.

### Step 2.4 — Affected detection builds ONLY page-markets

Register the new unit in `tools/release-tools/src/affected.ts` `DEPLOYABLE_UNITS`:

```ts
{ unit: "page-markets", packageName: "@mvp/page-markets",
  dir: "apps/page-markets", dockerfile: "apps/page-markets/Dockerfile",
  extraPathPrefixes: [] },
```

Then confirm a page-only change is isolated:

```bash
pnpm exec tsx scripts/affected.mts --base origin/main
```

- **Accept:** with only `apps/page-markets/**` changed, the `units` array
  contains **only `page-markets`** (the acceptance property from
  `RELEASE_MODEL.md`: a page-only change ⇒ only that page's image).
  `page-trade` / `page-product` / `shell-gateway` are **absent**.
- **Why trade is untouched:** `computeAffected` walks the pnpm dependency graph;
  nothing depends on `page-markets`, and `page-markets` sources touch no shared
  package, so no other unit is marked. (Beware: editing a **shared** package like
  `@mvp/design-system` fans out to every unit — keep this release page-local.)

### Step 2.5 — CI builds the page image

On push to `main`, the `affected` job emits a matrix with only `page-markets`;
the `docker` job builds `page-markets:<git-sha>` + `:latest`
(`--provenance=false --sbom=false`) and pushes it **only if** `REGISTRY_URL` +
credentials are configured.

- **Accept:** the CI `docker (page-markets)` matrix leg runs and no other
  unit's leg runs for a page-only diff.

### Step 2.6 — Smoke

`createDefaultSmokeChecks` in `tools/release-tools/src/smoke.ts` derives a
`page-markets` `/health` check from the route registry automatically. (A
shell composed-route marker check for `/markets`, like the existing `/` and
`/product/123` ones, would still be a hand-added extra.) Then:

```bash
docker compose -f infra/docker/docker-compose.yml build --provenance=false --sbom=false page-markets
docker compose -f infra/docker/docker-compose.yml up -d --no-build
pnpm exec tsx scripts/docker-smoke.mts --timeout 180
```

- **Accept:** docker-smoke `"ok": true`, including the derived
  `page-markets-health` check.

### Step 2.7 — Promote route canary → stable

Registry-level page promotion is **route-registry driven**. Today the
`promote-fragment` scripts operate on the **fragment** registry only, and
`route-registry` has no promote/rollback CLI. Two paths:

- **Interim (implemented):** flip the `RouteEntry.channel` from `canary` to
  `stable` in `packages/routes/src/registry.ts` and ship that one-line
  change. Because `@mvp/routes` is a normal workspace dependency of only
  `shell-gateway`, this rebuilds **shell-gateway**, not the pages.
- **Target (需补):** a `promote-route.mts` / `rollback-route.mts` pair mirroring
  the fragment scripts, writing route channel changes + a `releases.json`-style
  history for pages. Called out as a gap in `RELEASE_MODEL.md` §"Registry-level
  Release" (fragment scripts are a separate workstream; routes not yet scripted).

### Step 2.8 — Cluster rollout + rollback (Argo)

For the page **image** rollout (not the registry channel), reuse the
`page-product` canary pattern:

- Copy `infra/argo-rollouts/page-product-rollout.yaml` → `page-markets-rollout.yaml`
  (container/port 4104, `args: service-name: page-markets`), reusing the shared
  `success-rate` / `latency-p95` AnalysisTemplates.
- Release retargets the image and lets Argo shift traffic 10% → analysis → 50% →
  analysis → 100%, auto-reverting on a failed analysis:
  ```bash
  kubectl argo rollouts set image page-markets \
    page-markets=$REGISTRY_URL/page-markets:$GIT_SHA
  ```
- **Rollback:** `kubectl argo rollouts abort page-markets` (reverts to the stable
  ReplicaSet), or `kubectl rollout undo` for a plain Deployment.

### Example 2 — implemented vs. needs-补

| Piece | Status |
| --- | --- |
| `route-registry` shape + `matchRoute` + `validateRouteRegistry` + `PAGE_*_URL` override | **Implemented**. |
| Affected matrix isolates a page-only change | **Implemented** — once `page-markets` is in `DEPLOYABLE_UNITS`. |
| CI docker matrix + push gating | **Implemented**. |
| `page-markets` app, Dockerfile, compose/k8s entries | **需补** — new unit, does not exist yet. |
| Route **promote/rollback CLI** (canary→stable as a script + history) | **需补** — only fragment scripts exist; interim = edit the `RouteEntry.channel` (rebuilds shell-gateway). |
| Smoke checks for `/markets` | **需补** — extend `smoke.ts`. |
| Argo rollout for `page-markets` | **需补** — copy the `page-product` rollout; canary chain is real "on paper", analysis is **skeleton** until services export `/metrics` (GAP 2.4). |

---

## 3. Shared CI / canary / smoke plumbing (both examples)

| Mechanism | File | How the examples use it |
| --- | --- | --- |
| **Affected matrix** | `scripts/affected.mts` + `tools/release-tools/src/affected.ts` | New unit added to `DEPLOYABLE_UNITS`; a fragment-only or page-only diff rebuilds only that image. Shared-package edits fan out — keep releases local. |
| **CI verify gate** | `.github/workflows/ci.yml` job `verify` | `pnpm verify` (typecheck/lint/format/tests/build/6 audits + budgets) must be green before any image builds. |
| **Docker matrix** | ci.yml job `docker` (push to main, `has_units==true`) | Builds `<unit>:<sha>`+`:latest`, pushes only with registry creds. |
| **Compose smoke** | ci.yml job `e2e` → `scripts/docker-smoke.mts` | Boots the stack, polls `/health` + rendered pages + composed shell routes; extend `smoke.ts` for the new unit. |
| **Argo canary** | `infra/argo-rollouts/page-product-rollout.yaml` | 10→50→100 traffic with analysis between steps; copy per unit. |
| **Analysis / auto-rollback** | `infra/argo-rollouts/analysis-templates.yaml` | `success-rate ≥ 99%`, `p95 ≤ 500ms`; **skeleton** — queries `http_requests_total` / `http_request_duration_seconds_bucket`, which services don't export yet. Fragment `/metrics` from the lifecycle (spine §13) is the input that closes this. |

### Global "no cluster" boundary

The entire **registry + compose + smoke** loop runs **locally with zero cluster**
— that is the paved, demo-able road for both examples. Everything from
`kubectl argo rollouts` onward (traffic shifting, metric-gated auto-rollback,
image push) requires a cluster + Prometheus + registry credentials that are
**not part of this repo** (`RELEASE_MODEL.md` §"Canary and Rollback"). For the
demo, treat the k8s/Argo layer as **wired-on-paper**: manifests validate offline
(`kubectl kustomize infra/k8s`) and document the rollback criteria, but the live
metric analysis is `Inconclusive/Error` until `/metrics` lands.

---

## 4. One-glance command index

```bash
# ── Example 1: fragment (order-book) ──────────────────────────────
pnpm --filter @mvp/create-component start -- OrderBook --type fragment
pnpm --filter @mvp/fragment-order-book test
pnpm exec tsx scripts/register-fragment.mts --name order-book --version 0.1.0 \
  --service-url http://localhost:4203 --channel canary --with-compose
pnpm exec tsx scripts/mount-slot.mts --page page-trade --slot orderBook \
  --fragment order-book --strategy dynamic-ssr --channel canary --timeout-ms 200
pnpm verify
docker compose -f infra/docker/docker-compose.yml build --provenance=false --sbom=false order-book
docker compose -f infra/docker/docker-compose.yml up -d --no-build
pnpm exec tsx scripts/docker-smoke.mts --timeout 180
pnpm exec tsx scripts/promote-fragment.mts --name order-book
pnpm exec tsx scripts/rollback-fragment.mts --name order-book   # [--to 0.1.0]

# ── Example 2: page (page-markets) ────────────────────────────────
# 1. scaffold apps/page-markets (mirror page-product), add markets-table slot
# 2. add RouteEntry{ id:"markets", channel:"canary" } to route-registry
# 3. add Dockerfile + compose service + infra/k8s/page-markets.yaml + kustomization
# 4. add page-markets to DEPLOYABLE_UNITS, then:
pnpm exec tsx scripts/affected.mts --base origin/main      # units == ["page-markets"] only
pnpm verify
docker compose -f infra/docker/docker-compose.yml build --provenance=false --sbom=false page-markets
docker compose -f infra/docker/docker-compose.yml up -d --no-build
pnpm exec tsx scripts/docker-smoke.mts --timeout 180
# 5. promote: flip RouteEntry.channel canary->stable (interim) / promote-route.mts (target)
kubectl argo rollouts set image page-markets page-markets=$REGISTRY_URL/page-markets:$GIT_SHA
kubectl argo rollouts abort page-markets                   # rollback
```
