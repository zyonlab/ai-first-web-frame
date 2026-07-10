# 10 — Parallel Work Plan (multi-agent scheduling)

> Anchored to the [master-plan spine](README.md). This is the **operations manual
> for splitting the whole trade demo across many parallel agents**. It maps every
> new/changed file to a non-overlapping **agent slot**, freezes the cross-agent
> contracts that must stabilize before fan-out, and defines the phase gates. It
> corresponds to the spine §12 document set (each area doc has an owning agent
> here). When anything conflicts with the spine, the spine wins.

**How to use this doc.** Every future agent: (1) read the spine, (2) read its area
doc(s), (3) read the **contract-freeze checklist** (§3), (4) work **only** the
paths in its ownership row (§2), (5) exit its phase only when the **acceptance
gate** (§4) is green. The core discipline is **file-ownership partitioning**: no
two concurrently-running agents write the same file. Cross-agent needs go through
**frozen contracts**, never through editing each other's files.

---

## 1. Phases (entry / exit gates)

Seven phases. Phases gate on `pnpm verify` green plus phase-specific checks.
Within a phase, the listed agent slots run **in parallel** (their file sets are
disjoint). A later phase starts only after the earlier phase's **contracts are
frozen** (not necessarily its whole implementation, where noted).

| # | Phase | Goal | Entry gate | Exit gate |
| --- | --- | --- | --- | --- |
| **P0** | **Foundation** | `@mvp/design-system` (tokens + Tailwind preset + reset), `@mvp/trade-client` (island runtime + store client + chart adapter), shadcn vendoring into `packages/ui`, mock data transport + fixtures. | Spine + docs 02/03/04/09 drafted; contracts §3 **frozen**. | design-system tokens exported; trade-client mount API stable; `pnpm verify` green; UI primitives render in isolation. |
| **P1** | **Data plane + store** | `@mvp/data` realtime/ISR/request-time brokers, `@mvp/interaction` typed channels, shared trade store slices, `@mvp/storage` prefs, data-source id registry. | P0 contracts frozen (tokens, mount API, channel schema). | `subscribeData` + store slices unit-tested; mock transport deterministic; verify green. |
| **P2** | **Fragments** (high fan-out) | All trade/markets/portfolio SSR fragments + their islands (see §2 fragment slots). | P1 store/channel/data contracts frozen; fragment manifest shape frozen. | every fragment: contract + tests + budget + `/metrics` + `/health` + trace spans; verify green (budgets pass). |
| **P3** | **Pages + shell chrome + menu** | `apps/page-trade`, `page-markets`, `page-portfolio` (+ light vaults/referrals); shell nav, complex menu, wallet/theme/locale controls, command palette; route-registry entries. | P2 fragment manifests registered; nav/menu spec (doc 06) frozen. | pages compose fragments via slots; `matchRoute` covers all routes; verify green; page-level e2e smoke. |
| **P4** | **i18n + theming** | Locale namespaces (`en`/`zh`), two theme token sets, no-flash SSR, persistence via `@mvp/storage`. | P0 token-set contract frozen; P3 surfaces exist to translate/theme. | theme + locale switch with no flash; namespaces per surface; verify green. |
| **P5** | **Trace UI** | Upgrade observability: waterfall/Gantt trace island + span lanes + budget/hint overlays + dependency graph (spine §10). | P1 trace-span shape frozen; P2 fragments emitting spans/`/metrics`. | trace UI renders from trace JSON + `/metrics`; verify green. |
| **P6** | **Deployment + e2e** | Both deploy examples ([07](07-deployment-examples.md)) wired: order-book fragment flow, page-markets page flow; affected/smoke/e2e for new units. | P2/P3 units exist and are in the registry. | affected isolates units; docker-smoke green; e2e specs green; verify green. |

**Parallelism note.** P2 is the widest fan-out (one agent per fragment, ~9+). P4,
P5, P6 can overlap with the **tail** of P3 once their input contracts are frozen,
because their file sets are disjoint from P3's page shells.

---

## 2. Ownership matrix (non-overlapping file sets)

Each **agent slot** owns an exclusive set of paths. Two slots never write the same
file; shared needs are mediated by frozen contracts (§3). "Depends on" lists the
slots whose **contracts** must be frozen (⟨C⟩) or **outputs** must exist (⟨O⟩)
before this slot can finish.

### P0 — Foundation

| Slot | Owns (exclusive paths) | Depends on | Produces (consumed by) | Doc |
| --- | --- | --- | --- | --- |
| **A0-design** | `packages/design-system/**` (tokens, Tailwind preset, base reset CSS), Tailwind config surface | — | design tokens + preset (all UI/fragments/pages) | 09, 04 |
| **A0-client** | `packages/trade-client/**` (React island bootstrap, interaction store client, chart adapter) | A0-design ⟨C⟩ | island mount API + store client (all islands) | 09, 02 |
| **A0-ui** | `packages/ui/src/**` shadcn-vendored primitives (`AppNav`, `WalletMenu`, `ThemeToggle`, `LocaleSwitcher`, `CommandPalette`, `DataTable`, `Tabs`, `Dialog`, `Tooltip`, `Slider`, `Toast`) | A0-design ⟨C⟩, A0-client ⟨C⟩ | UI primitives (shell + pages) | 04 |
| **A0-mock** | `packages/data/src/transport/**` mock `SubscriptionTransport` + seeded generators + fixtures | — | deterministic feed (data plane, fragments) | 03 |

### P1 — Data plane + store

| Slot | Owns | Depends on | Produces | Doc |
| --- | --- | --- | --- | --- |
| **A1-data** | `packages/data/src/**` (broker: realtime/ISR/request-time, dedupe, `subscribeData`), data-source **id registry** | A0-mock ⟨O⟩ | data read/subscribe API + source ids (fragments, pages) | 03 |
| **A1-store** | `packages/interaction/src/**` typed channels + trade store slices (`activeSymbol`, `orderDraft`, `chartInterval`, `hoveredPrice`, `bookGrouping`) | A0-client ⟨C⟩ | `InteractionContract` (islands) | 03, 07-store flows |
| **A1-storage** | `packages/storage/src/**` (watchlist, layout prefs, recent symbols, theme+locale persistence) | — | prefs API (shell, pages, theming) | 05 |

### P2 — Fragments (one agent per fragment; all file sets disjoint)

| Slot | Owns `fragments/<name>/**` | Data class (spine §5) | Depends on | Doc |
| --- | --- | --- | --- | --- |
| **A2-header** | `fragments/market-header/**` | near-realtime, small island | A1-data ⟨C⟩, A1-store ⟨C⟩ | 02, 03 |
| **A2-chart** | `fragments/chart-panel/**` | candles + ISR history, island | A1-data ⟨C⟩, A0-client (chart adapter) ⟨O⟩ | 02, 03 |
| **A2-book** | `fragments/order-book/**` | **realtime**, patch-only | A1-data ⟨C⟩, A1-store ⟨C⟩ | 02, 03, 07 |
| **A2-trades** | `fragments/trades-feed/**` | **realtime**, patch-only | A1-data ⟨C⟩ | 02, 03 |
| **A2-form** | `fragments/order-form/**` | request-time + realtime margin, island | A1-data ⟨C⟩, A1-store ⟨C⟩ | 02, 03 |
| **A2-positions** | `fragments/positions-table/**` | **realtime**, patch-only | A1-data ⟨C⟩ | 02, 03 |
| **A2-orders** | `fragments/open-orders/**` | realtime/request-time, patch-only | A1-data ⟨C⟩ | 02, 03 |
| **A2-account** | `fragments/account-bar/**` | request-time + realtime, small | A1-data ⟨C⟩, A1-store ⟨C⟩ | 02, 03 |
| **A2-funding** | `fragments/funding-bar/**` | near-realtime, no island | A1-data ⟨C⟩ | 02, 03 |
| **A2-markets** | `fragments/markets-table/**` | near-realtime | A1-data ⟨C⟩ | 02, 03 |
| **A2-portfolio** | `fragments/portfolio-summary/**` | request-time | A1-data ⟨C⟩ | 02, 03 |
| **A2-pnl** | `fragments/pnl-chart/**` | ISR | A1-data ⟨C⟩ | 02, 03 |

> Each A2 slot **also** owns its registry/compose registration for its fragment,
> run via scripts (never hand-editing JSON): `register-fragment` writes
> `registry.data.json` + `docker-compose.yml`. To avoid a write-conflict on those
> **shared** files, registrations are **serialized through the P2→P3 integrator**
> (**A3-integrate** below), or run sequentially at the end of P2. See §5 risk R4.

### P3 — Pages + shell + menu + routing

| Slot | Owns | Depends on | Doc |
| --- | --- | --- | --- |
| **A3-trade** | `apps/page-trade/**` (route container, `manifest.slots.json`, `fragmentSlots.ts`, layout) | A2 trade fragments registered ⟨O⟩ | 01, 06 |
| **A3-markets** | `apps/page-markets/**` | A2-markets ⟨O⟩ | 06, 07 |
| **A3-portfolio** | `apps/page-portfolio/**` | A2-portfolio, A2-pnl ⟨O⟩ | 06 |
| **A3-light** | `apps/page-vaults/**`, `apps/page-referrals/**` (static/ISR) | A0-ui ⟨C⟩ | 06 |
| **A3-shell** | `apps/shell-gateway/src/**` (nav + complex menu, wallet/theme/locale controls, command palette, global chrome, CSP/tokens/fonts) | A0-ui ⟨O⟩, A1-storage ⟨C⟩ | 06 |
| **A3-routes** | `packages/routes/src/registry.ts` (RouteEntries for trade/markets/portfolio/vaults/referrals) | A3 pages exist ⟨O⟩ | 06, 07 |
| **A3-integrate** | shared registration files: `registry/registry.data.json`, `infra/docker/docker-compose.yml` (runs `register-fragment`/`mount-slot` for all P2 fragments); `tools/release-tools/src/affected.ts` (`DEPLOYABLE_UNITS`), `tools/release-tools/src/smoke.ts` | all P2 ⟨O⟩, A3 pages ⟨O⟩ | 07 |

### P4 — i18n + theming

| Slot | Owns | Depends on | Doc |
| --- | --- | --- | --- |
| **A4-theme** | `packages/design-system/src/themes/**` (light/dark token sets), `packages/assets/src/**` theme injection + no-flash cookie wiring | A0-design ⟨C⟩, A1-storage ⟨C⟩ | 05 |
| **A4-i18n** | `packages/assets/src/i18n/**` or `packages/i18n/**` namespaces (`nav`, `trade`, `markets`, `portfolio`) for `en`/`zh` | A3 surfaces exist ⟨O⟩ | 05 |

> Note: A4-theme and A4-i18n both touch `packages/assets` — **partition by
> subdirectory** (`.../themes` vs `.../i18n`) so their file sets stay disjoint. If
> that split is not clean, sequence them.

### P5 — Trace UI

| Slot | Owns | Depends on | Doc |
| --- | --- | --- | --- |
| **A5-trace** | `packages/observability/src/traceUi/**` + `fragments/trace-waterfall/**` (Gantt span timeline, cache/realtime lanes, budget/hint overlays, dependency graph) | A1 trace-span shape ⟨C⟩, A2 fragments emitting spans/`/metrics` ⟨O⟩ | 08 |

### P6 — Deployment examples + e2e

| Slot | Owns | Depends on | Doc |
| --- | --- | --- | --- |
| **A6-deploy** | `infra/k8s/page-*.yaml` + `infra/k8s/kustomization.yaml` (add entries), `infra/argo-rollouts/page-markets-rollout.yaml`, deploy runbook validation | A3-integrate ⟨O⟩ | 07 |
| **A6-e2e** | `e2e/**` specs (trade flows: book-click→form, leverage broadcast, symbol switch), `playwright.config.ts` project entries | A3 ⟨O⟩ | 07 |

> **Ownership rule for shared registration files.** `registry.data.json`,
> `releases.json`, `docker-compose.yml`, `route-registry.ts`, `affected.ts`,
> `smoke.ts`, `kustomization.yaml` are **hot shared files**. They are owned by a
> **single integrator slot per phase** (A3-integrate for P2/P3, A6-deploy for
> infra), never by fan-out fragment/page agents directly. Fan-out agents request
> registration; the integrator serializes the script runs.

---

## 3. Contract-freeze checklist (freeze before fan-out)

These interfaces MUST be frozen (typed + documented in their area doc) before the
dependent phase's agents start. A change to a frozen contract after fan-out is a
**breaking event** — it requires re-syncing every consumer (see risk R3).

| # | Contract | Owner slot | Frozen shape | Unblocks |
| --- | --- | --- | --- | --- |
| **C1** | **Design tokens** — CSS-variable names + Tailwind `theme.extend` mapping (single source of truth) | A0-design | token names, scales, `@mvp/design-tokens` export surface | A0-ui, all fragments, A4-theme |
| **C2** | **Island mount API** — how `@mvp/trade-client` mounts an island (mount fn signature, hydration entry, chart-adapter interface) | A0-client | `mount(el, props)` + store-client handle + chart adapter iface | all islands (A2-chart/book/form/…), A3-shell |
| **C3** | **`InteractionContract`** — store slice names + payload types (`activeSymbol`, `orderDraft{side,price,size,leverage,reduceOnly}`, `chartInterval`, `hoveredPrice`, `bookGrouping`) + channel topic ids | A1-store | typed channels + slice payloads (Zod in `@mvp/contracts`) | A2-book/form/account/header, A3-shell (palette) |
| **C4** | **Data read/subscribe API** — `subscribeData`/read signatures, freshness classes, dedupe keys | A1-data | function signatures + result envelope | all A2 fragments, pages |
| **C5** | **Data-source id naming** — canonical ids (e.g. `book.l2.<symbol>`, `ticker.<symbol>`, `positions`, `candles.<symbol>.<interval>`) | A1-data | id namespace convention + registry | all A2 fragments, A5-trace (dep graph) |
| **C6** | **Fragment manifest shape** — render output (`html`, `assets.{js,css}`, `cache{ttl,tags}`, `metadata{name,version}`), `/manifest` + `/health` + `/metrics` + trace-span envelope | A0-client + A1-data jointly; validated in `@mvp/contracts` | manifest + span schema | all A2 fragments, A3-integrate, A5-trace |
| **C7** | **Slot descriptor shape** — `manifest.slots.json` entry (`name`, `fragment`, `channel`, `strategy`, `timeoutMs`, `props`, `required`) | existing (`packages/registry/src/slots.ts`) — **already frozen** | as-is | A3 pages, A3-integrate |
| **C8** | **RouteEntry shape** — `{id,path,page,serviceUrl,channel}` | existing (`route-registry`) — **already frozen** | as-is | A3-routes, A6-deploy |
| **C9** | **Theme token-set contract** — light/dark variable sets + no-flash cookie key | A4-theme | two token sets read by Tailwind + fragments | A0-ui, all surfaces |

C7 and C8 already ship in the repo — treat them as pre-frozen. C1–C6 and C9 are
the new freezes gating fan-out.

---

## 4. Milestones + acceptance gates

Every phase exit requires **`pnpm verify` = exit 0** (typecheck, lint, format,
tests, build, 6 audits, **budgets**). Additional per-phase gates:

| Milestone | Gate commands | Accept |
| --- | --- | --- |
| **M0** Foundation | `pnpm verify` | tokens/preset export; trade-client mount API typed; shadcn primitives render in unit tests; verify green. |
| **M1** Data+store | `pnpm verify`; `pnpm exec vitest run packages/data packages/interaction` | deterministic mock feed; store slices + channels unit-tested; verify green. |
| **M2** Fragments | `pnpm verify`; per-fragment `pnpm --filter @mvp/fragment-<name> test` | every fragment green + **budget passes** + `/health`/`/metrics`/spans present; similarity audit clean. |
| **M3** Pages/shell | `pnpm verify`; `pnpm exec tsx scripts/affected.mts`; `docker compose config` | pages compose slots; `matchRoute` covers all routes; affected isolates each unit; verify green. |
| **M4** i18n/theme | `pnpm verify`; theme/locale e2e | no-flash theme + locale switch; namespaces per surface; verify green. |
| **M5** Trace UI | `pnpm verify`; trace-UI render test | waterfall renders from trace JSON + `/metrics`; budget/hint overlays; dep graph. |
| **M6** Deploy+e2e | `pnpm verify`; `docker-smoke`; `pnpm e2e` | both deploy examples runnable end-to-end; docker-smoke `ok:true`; e2e green. |

**Cross-cutting acceptance:** the three canonical store flows (spine §7) must pass
e2e by M6 — order-book row click → order-form update without SSR re-render;
leverage slider → account-bar + form margin preview; symbol switch → chart/book/
form resubscribe while shell chrome does **not** re-render.

---

## 5. Risks + mitigations

| # | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| **R1** | **Tailwind/shadcn intro blows budgets/audits** — new CSS/JS + Radix trees hit hard per-unit budgets and the similarity/dependency audits. | P0/P2 budget failures in `pnpm verify`. | shadcn/Radix **only** in client islands via `@mvp/trade-client` (one shared React chunk, spine §4); high-frequency panels stay **SSR token-CSS**, no Radix. Tailwind theme maps onto existing tokens (C1) — no divergent color system. Budget-check each primitive in P0 before fan-out. |
| **R2** | **Realtime island bloats bundle** — every island re-bundling React/chart libs. | Fragment JS-budget fails; slow first paint. | Single island runtime in `@mvp/trade-client`, referenced as a **shared dependency** via `@mvp/assets` (spine §11); fragments declare it, don't re-bundle. Patch-only fragments (book/trades/positions) ship **no React** — SSR + `subscribeData` patch. |
| **R3** | **Cross-agent contract drift** — a frozen contract (C1–C6/C9) changes mid-fan-out. | Every consumer breaks; parallel work stalls. | Freeze C1–C6/C9 **before** the dependent phase (§3); encode them as Zod schemas in `@mvp/contracts` so a drift **fails typecheck/tests loudly**; contract changes go through the spine amendment process, then a re-sync sweep of consumers. |
| **R4** | **Write-conflict on hot shared files** — many fragment agents editing `registry.data.json` / `docker-compose.yml`. | Merge conflicts; corrupted JSON. | Those files are owned by a **single integrator slot** (A3-integrate / A6-deploy); fan-out agents never write them directly — they run `register-fragment`/`mount-slot` **serialized** through the integrator. Scripts are idempotent (`action:"unchanged"`) and Zod-validate on load. |
| **R5** | **Fragment-vs-page dependency inversion** — a page agent needs a fragment not yet registered. | P3 blocked. | Phase gates: P3 starts only after P2 fragments are **registered** (⟨O⟩), not merely coded. Light pages (A3-light) that need no fragments can start earlier. |
| **R6** | **Shared-package edit fans out every unit** — touching `@mvp/design-system` in a "single-page" release rebuilds everything. | Breaks the independent-deploy demo (07). | Keep P4/P5 shared-package changes on their **own** release train; the deploy examples (07) deliberately edit only page/fragment-local files so `affected` isolates one unit. |
| **R7** | **Trace/metrics gap** — Argo analysis + trace UI need `/metrics` that fragments may not emit. | P5/P6 canary analysis is Inconclusive. | Make `/metrics` + trace-span emission part of the **fragment lifecycle contract** (C6, spine §13) so every P2 fragment ships it; A5-trace consumes it. Cluster-side auto-rollback stays "wired-on-paper" per 07 §3. |

---

## 6. This document's job

This is the **dispatch manual** for handing the trade demo to many parallel
agents. The recipe:

1. **Draft the area docs** (01–09) — each is an independent, single-owner writing
   task (the same partitioning discipline, applied to docs).
2. **Freeze contracts** C1–C6/C9 (§3).
3. **Fan out by phase** (§1), each agent bound to its **exclusive path set** (§2).
4. **Gate every phase** on `pnpm verify` + the phase's checks (§4).
5. **Route all cross-agent needs through frozen contracts and integrator slots**,
   never through editing another agent's files (§5 R3/R4).

Each area doc (spine §12) has an owning agent slot in §2, so this plan and the
document set are one-to-one.

---

## Appendix A — Ownership coverage vs. area docs 02–08

Cross-check that every artifact named in the spine's area-doc scopes has an owner.

| Area doc | Named artifacts | Owner slot(s) | Covered? |
| --- | --- | --- | --- |
| **02 component-architecture** | 9 trade fragments + markets/portfolio/pnl fragments; islands; shared UI primitives; render/hydration contract; per-component manifest; ownership matrix | A2-* (fragments), A0-ui (primitives), A0-client (hydration), C6 (manifest contract) | **Yes** |
| **03 data-architecture** | data sources; freshness classes; dedupe/cache; shared client store; interaction channels + payload contracts; mock transport | A1-data (broker + source ids), A1-store (store + channels), A0-mock (transport), C3/C4/C5 | **Yes** |
| **04 shadcn-and-styling** | Tailwind+shadcn integration; token bridge; island vs SSR styling; component vendoring list; budget impact | A0-design (token bridge/preset), A0-ui (vendoring), R1 (budget) | **Yes** |
| **05 i18n-and-theming** | locale/namespace layout; theme token sets; no-flash SSR; persistence; RTL note | A4-i18n (namespaces), A4-theme (token sets + no-flash), A1-storage (persistence), C9 | **Yes** |
| **06 navigation-and-routing** | complex menu spec; route registry entries; page shells; command palette; deep-linking symbols | A3-shell (menu/palette), A3-routes (route entries), A3-trade/markets/portfolio/light (shells), A0-ui (CommandPalette primitive) | **Yes** |
| **08 observability-and-trace-ui** | trace waterfall UI; span lanes; budget/hint overlays; dependency graph; data model | A5-trace; input contract C6 (span envelope) + C5 (source ids for dep graph) | **Yes** |

### Coverage gaps to confirm when the area docs are written

These are owned in §2 but **inferred from the spine**, not yet pinned by a
detailed doc — verify no artifact is missed once docs 02–08 exist:

- **`@mvp/assets` load-order/dedupe/SRI/budget-attribution** (spine §11, doc 09):
  currently split between A4-theme (injection) and A0-client/A1-data via C6. If
  doc 09 defines a dedicated asset-plane surface, assign a **dedicated A0-assets
  slot** owning `packages/assets/**` to avoid the A4-theme/A4-i18n subdirectory
  split (R4-style partition) — **flagged for confirmation**.
- **Wallet/connect data + session** (spine §2 shell "global data"): the wallet
  *menu* is A0-ui/A3-shell, but the **session/wallet request-time data source** is
  an A1-data source id (C5) — confirm it's enumerated in doc 03.
- **Chart adapter vendor lib** (A0-client / A2-chart): the TradingView-style chart
  region's underlying lib choice and its bundle cost (R2) must be pinned in doc 02
  before A2-chart fans out.
- **Command-palette symbol index** (deep-linking, doc 06): the symbol quick-switch
  reads the markets index (global data, A1-data source id) — confirm the id in C5.

All four are **assigned** in §2; the note only flags that their exact file
boundaries need confirmation against the detailed docs so ownership stays
non-overlapping.
