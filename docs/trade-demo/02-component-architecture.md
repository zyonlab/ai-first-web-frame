# 02 — Component Architecture

> Anchored to [README.md](README.md) spine; **layout/behavior fidelity only, no proprietary assets**.
> This doc defines fragment boundaries, render/manifest contracts, island hydration contracts, the
> shared-UI list, and the agent ownership matrix. It is implementation-ready: each fragment mirrors
> the existing `fragments/promotion-banner` structure and each page mirrors `apps/page-product`.

Last updated: 2026-07-06 · Owner: component-architecture agent · Spine sections: §2, §4, §5, §6, §7, §11, §13.
Layout regions referenced from [01-ui-layout.md](01-ui-layout.md) §4.

---

## 1. Model recap (what the existing code gives us)

Verified against the repo so contracts stay real:

- **A fragment** = a Fastify SSR service with `src/{server,render,manifest,budget,data,observability}.ts`
  exposing `/health /metrics /manifest /assets /budget` and `POST /render` (see
  `fragments/promotion-banner/src/server.ts`). `/render` takes `{ ctx, props }` and returns
  `{ html, assets:{js,css}, cache:{ttl,tags}, metadata:{name,version} }` — this is the
  `FragmentRenderResponse` contract consumed by `@mvp/runtime` `fetchFragment`.
- **A page** = a Next app (`apps/page-*`) whose server code calls
  `executeFragmentSlots({ registry, ctx, slots, dataDependencies, resolveData, trace })`
  (`packages/runtime/src/index.ts`) and injects each slot's `response.html` via
  `dangerouslySetInnerHTML` (pattern in `apps/page-home/app/page.tsx`). The page manifest
  (`src/manifest.ts` + `src/manifest.slots.json`) mirrors `apps/page-product`.
- **An island** = a `"use client"` React component rendered inside the RSC page, given an
  `initialSnapshot` prop for SSR-first paint, subscribing to data via `@mvp/data` `subscribeData`
  and to cross-component events via `@mvp/interaction` (pattern in
  `apps/page-home/app/RealtimeInsights.tsx`). Per spine §4/§11, **every trade island mounts through
  `@mvp/trade-client`** so React/Radix bundle once.
- **Render strategies** available on a slot: `static | isr | cached-ssr | dynamic-ssr`
  (`RenderStrategy` + `fetchFragmentSlot` in runtime). Caching is keyed by `createFragmentCacheKey`.

The trade demo adds no new runtime primitive; it composes these.

---

## 2. Fragment boundary catalog

Nine trade-page fragments + one rail + three markets/portfolio fragments. Each row states the
**render contract** (input `ctx`+`props` → output HTML+assets), which sub-parts are **islands**, and
the **SSR↔island seam** (initial snapshot + patch).

### 2.1 Trade-page fragments

| Fragment | `props` in | HTML out (SSR snapshot) | Island sub-parts | Seam (snapshot → patch) |
| --- | --- | --- | --- | --- |
| `market-header` | `{symbol}` | one dense stat row: mark/oracle/24h/funding/vol + countdown placeholder | countdown ticker (small) | SSR renders last-known stats; island patches `mark`, `funding`, `countdown` text nodes on ticker tick |
| `chart-panel` | `{symbol, interval}` | chart container + interval chips + bootstrap candle count; static SVG sparkline fallback | chart adapter + interval control (full) | SSR emits candle bootstrap JSON in a `<script type="application/json">`; island reads it, mounts chart, then subscribes live candle |
| `order-book` | `{symbol, grouping, depth}` | full L2 ladder table with depth-bar `--depth` vars + spread row | **patch-only** (no controls in SSR except grouping chips) | SSR renders ordered levels keyed by price; island replaces cell text + `--depth` per level, flashes changed rows |
| `trades-feed` | `{symbol, limit}` | recent prints table (newest first) | **patch-only** | SSR renders last N prints; island prepends new prints, trims to N |
| `order-form` | `{symbol}` | market/limit tabs, size input, leverage track, buy/sell buttons, margin preview | Slider + side toggle + submit + limit-price input (full) | SSR renders default draft; island binds to `orderDraft` store slice (price from book clicks, leverage, side) |
| `positions-table` | `{}` (account from ctx) | positions rows: size/entry/mark/liq/uPnL + close controls | **patch-only** + row-action buttons | SSR renders current positions; island patches mark/uPnL/liq cells, recolors by sign |
| `open-orders` | `{}` | working-orders rows + cancel controls | **patch-only** + cancel buttons | SSR renders current orders; island adds/removes rows on fills/cancels |
| `account-bar` | `{}` | equity / margin usage / withdrawable stat row | small (margin-usage meter) | SSR renders request-time snapshot; island patches margin usage on leverage change + realtime margin |
| `funding-bar` | `{symbol}` | funding schedule + next-funding countdown + conn badge | **no island** (server countdown seed; optional CSS-only) | pure SSR; countdown is a CSS/`<time>` seed, refreshed on navigation |
| `marketrail` | `{activeSymbol}` | pair list + watchlist stars, y-scroll | small (star toggle, filter input) | SSR renders market list; island toggles stars (→`@mvp/storage`) + filters client-side |

### 2.2 Markets / portfolio fragments

| Fragment | `props` in | HTML out | Island | Notes |
| --- | --- | --- | --- | --- |
| `markets-table` | `{sort, filter}` | full sortable markets table rows | small (sort/filter) | near-realtime; row → `/trade/:symbol` |
| `portfolio-summary` | `{}` | 4 stat cards (equity/uPnL/margin/withdrawable) | none | request-time SSR |
| `pnl-chart` | `{range}` | equity-curve SVG | small (hover readout) | ISR |

Fallback contract (all fragments): on missing/invalid props or error, return
`{ statusCode: 200, body: <no-js-readable fallback section data-fallback="true"> }`, exactly like
`createPromotionFallback`. The runtime treats `data-fallback="true"` as a degraded slot.

---

## 3. Manifest drafts (one per fragment)

Each mirrors `promotion-banner/src/manifest.ts` shape and is validated by the fragment's
`validate*Manifest`. `renderStrategy` here is the **fragment-declared default**; the *slot* may
override strategy per mount (spine §6, runtime `FragmentSlotDefinition.strategy`). Assets list the
shared `@mvp/trade-client` chunk as a **shared dependency** (spine §11) rather than re-bundling it.
Budgets align with the `fragment` budget shape (`jsBytes/cssBytes/maxFragmentLatencyMs/maxRenderMs/maxMemoryMB`).

| Fragment | renderMode | renderStrategy | cachePolicy (ttl, vary) | assets.js | assets.css | jsBytes | cssBytes | dependsOn / dataDeps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `market-header` | ssr | cached-ssr | 5s · tenant,locale,props | `@mvp/trade-client` (shared) | header.css | 8k | 8k | data: `ticker:{symbol}` |
| `chart-panel` | ssr | isr | 60s (history) · locale,props | shared + chart-adapter | chart.css | 22k | 10k | data: `candles:{symbol,interval}` |
| `order-book` | ssr | dynamic-ssr | none (realtime) | shared | book.css | 14k | 10k | data: `book:{symbol}` |
| `trades-feed` | ssr | dynamic-ssr | none (realtime) | shared | trades.css | 10k | 8k | data: `trades:{symbol}` |
| `order-form` | ssr | dynamic-ssr | none (request-time) | shared | form.css | 26k | 12k | data: `account`, `leverageTiers:{symbol}` |
| `positions-table` | ssr | dynamic-ssr | none (realtime) | shared | positions.css | 14k | 10k | data: `positions` |
| `open-orders` | ssr | dynamic-ssr | none | shared | orders.css | 12k | 8k | data: `orders` |
| `account-bar` | ssr | dynamic-ssr | none | shared | account.css | 8k | 6k | data: `account` |
| `funding-bar` | ssr | cached-ssr | 30s · props | (none) | funding.css | 0 | 6k | data: `funding:{symbol}` |
| `marketrail` | ssr | cached-ssr | 10s · locale | shared | rail.css | 8k | 8k | data: `markets` |
| `markets-table` | ssr | cached-ssr | 5s · locale,props | shared | markets.css | 12k | 12k | data: `markets` |
| `portfolio-summary` | ssr | dynamic-ssr | none (request-time) | (none) | summary.css | 0 | 8k | data: `account` |
| `pnl-chart` | ssr | isr | 300s · props | shared + chart-adapter | pnl.css | 18k | 8k | data: `equityCurve` |

`vary` values are the runtime-supported set: `tenant | locale | experiment | device | props`.
Budgets are drafts to be tightened during TDD; each must pass `pnpm verify` (spine §13). Data
dependency ids map to spine §6 classes and are detailed in
[03-data-architecture.md](03-data-architecture.md) — this doc references them by id only.

### 3.1 Example manifest (order-book) — literal shape to copy

```ts
export const orderBookManifest = {
  name: "order-book",
  owner: "trading-core",
  version: "0.1.0",
  renderMode: "ssr",
  renderStrategy: "dynamic-ssr",
  cachePolicy: { ttl: 0, tags: ["book"], vary: ["locale", "props"] },
  endpoint: "/render",
  fallback:
    '<section data-fragment="order-book" data-fallback="true">Order book unavailable</section>',
  assets: { js: ["@mvp/trade-client"], css: ["/assets/order-book.css"] },
  budget: orderBookBudget, // { scope:"fragment", jsBytes:14000, cssBytes:10000, maxFragmentLatencyMs:120, maxRenderMs:40, maxMemoryMB:20 }
  metadata: { category: "trading", description: "Realtime L2 order book ladder with depth bars" },
} as const;
```

---

## 4. Slot composition (trade page)

`apps/page-trade` composes these via `executeFragmentSlots`, mirroring
`apps/page-product/src/fragmentSlots.ts`. Draft slot set:

```ts
slots: [
  { name: "marketHeader", fragment: "market-header", strategy: "cached-ssr", dataDependencies: ["ticker"] },
  { name: "chart",        fragment: "chart-panel",   strategy: "isr",         dataDependencies: ["candles"] },
  { name: "book",         fragment: "order-book",    strategy: "dynamic-ssr", dataDependencies: ["book"] },
  { name: "trades",       fragment: "trades-feed",   strategy: "dynamic-ssr", dataDependencies: ["trades"] },
  { name: "orderForm",    fragment: "order-form",    strategy: "dynamic-ssr", dataDependencies: ["account","leverageTiers"] },
  { name: "positions",    fragment: "positions-table", strategy: "dynamic-ssr", dataDependencies: ["positions"] },
  { name: "openOrders",   fragment: "open-orders",   strategy: "dynamic-ssr", dataDependencies: ["orders"] },
  { name: "accountBar",   fragment: "account-bar",   strategy: "dynamic-ssr", dataDependencies: ["account"] },
  { name: "fundingBar",   fragment: "funding-bar",   strategy: "cached-ssr",  dataDependencies: ["funding"] },
  { name: "rail",         fragment: "marketrail",    strategy: "cached-ssr",  dataDependencies: ["markets"] },
]
```

- `account` is declared as a shared data node (spine §6) so `account-bar`, `order-form`,
  `positions-table` reuse **one** resolution — this deliberately triggers the runtime's
  `duplicate-data-resolution` hint proving single-read dedupe (as page-product does for
  `product-summary`).
- Slots are mounted via `scripts/mount-slot.mts` per the CLAUDE.md lifecycle; `manifest.slots.json`
  is the on-disk record. `book/trades/positions/orders` are `required:false` so a single failing
  realtime fragment degrades (not breaks) the page.

---

## 5. Island hydration contracts

All islands mount through **`@mvp/trade-client`** (spine §4 pt.4, §11). `trade-client` exposes a
single bootstrap that (a) hydrates React once, (b) provides the shared client store, (c) exposes the
chart adapter. Each island declares: **mount point** (a stable `data-island` element in the
fragment's SSR HTML), **initial props** (read from an inline JSON snapshot the fragment emits), and
the **store slice** it reads/writes (spine §7 slices: `activeSymbol`, `orderDraft`, `chartInterval`,
`hoveredPrice`, `bookGrouping`).

| Island | Mount point (in SSR HTML) | Initial props (from inline snapshot) | Store slice read | Store slice write | Data subscription (`@mvp/data`) |
| --- | --- | --- | --- | --- | --- |
| chart | `[data-island="chart"]` in chart-panel | `{symbol, interval, candles[]}` | `activeSymbol`,`chartInterval` | `chartInterval` | `candles:{symbol,interval}` (rt) |
| order-book patch | `[data-island="book"]` | `{symbol, levels[], grouping}` | `activeSymbol`,`bookGrouping` | `hoveredPrice`,`orderDraft.price` | `book:{symbol}` (realtime) |
| trades patch | `[data-island="trades"]` | `{symbol, prints[]}` | `activeSymbol` | — | `trades:{symbol}` (realtime) |
| order-form | `[data-island="orderForm"]` | `{symbol, draft, tiers}` | `orderDraft`,`activeSymbol` | `orderDraft.*` | `account`,`leverageTiers` |
| account-bar | `[data-island="accountBar"]` | `{equity, marginUsed, withdrawable}` | `orderDraft.leverage` | — | `account` (rt margin) |
| positions patch | `[data-island="positions"]` | `{positions[]}` | `activeSymbol` | `orderDraft` (reduce-only on close) | `positions` (realtime) |
| open-orders patch | `[data-island="openOrders"]` | `{orders[]}` | — | — | `orders` (realtime) |
| market-header ticker | `[data-island="marketHeader"]` | `{symbol, mark, funding, nextFundingTs}` | `activeSymbol` | — | `ticker:{symbol}` (near-rt) |
| marketrail | `[data-island="rail"]` | `{markets[], watchlist[]}` | `activeSymbol` | `activeSymbol` (on row click) | `markets` (near-rt) |
| command palette | in shell topbar | `{markets[]}` | — | `activeSymbol` | `markets` |
| wallet/theme/locale | shell topbar | session/theme/locale | — | (theme/locale via `@mvp/storage`) | session (request-time) |

**Snapshot format.** Each fragment emits its island props as
`<script type="application/json" data-island-props="<name>">…</script>` inside its SSR HTML. The
island reads it with `JSON.parse` on mount (no network needed for first interactivity), then
subscribes. This is the trade-client generalization of `RealtimeInsights`' `initialSnapshot` prop.

**Patch discipline (spine §13).** Patch-only islands (`book/trades/positions/orders`) mutate the
existing SSR DOM in place keyed by a stable id (price level / order id) — they do **not** re-render
the SSR page or sibling fragments. This is the observable "only this island re-renders" guarantee
from `RealtimeInsights` extended to tables.

**Cross-component flows (spine §7) realized here:**
1. book row click → `orderDraft.price` → order-form limit input (no page re-render).
2. leverage slider → `orderDraft.leverage` → account-bar + order-form margin preview.
3. ⌘K symbol switch → `activeSymbol` → chart/book/form/header/trades resubscribe; shell chrome static.

---

## 6. Shared-UI component list (packages/ui via shadcn)

Per spine §4/§5, shadcn primitives are **vendored** (copy-in source, restyled to tokens) into
`packages/ui` and shipped only as client islands through `@mvp/trade-client`. shadcn source is
detailed in [04-shadcn-and-styling.md](04-shadcn-and-styling.md); this table is the inventory.

| Shared-UI | shadcn source (see 04) | Radix dep | Used by (regions) | Island |
| --- | --- | --- | --- | --- |
| `AppNav` | navigation-menu | `@radix-ui/react-navigation-menu` | topbar | yes |
| `CommandPalette` | command + dialog | `cmdk` + `@radix-ui/react-dialog` | topbar ⌘K | yes |
| `WalletMenu` | dropdown-menu | `@radix-ui/react-dropdown-menu` | topbar | yes |
| `ThemeToggle` | toggle / button | — | topbar | small |
| `LocaleSwitcher` | select | `@radix-ui/react-select` | topbar | small |
| `Tabs` | tabs | `@radix-ui/react-tabs` | ledger, mobile stacks | yes |
| `DataTable` | table (headless) | — | ledger, markets, portfolio | patch |
| `Dialog` | dialog | `@radix-ui/react-dialog` | mobile order sheet, confirms | yes |
| `Tooltip` | tooltip | `@radix-ui/react-tooltip` | book/PnL hovers | yes |
| `Slider` | slider | `@radix-ui/react-slider` | leverage | yes |
| `Toast` | toast/sonner | `@radix-ui/react-toast` | order feedback | yes |

Existing non-shadcn `packages/ui` primitives (`Button`, `Card`, `Section`, `Skeleton`,
`ProductCardBase`, `Image`) are reused where they already fit (buttons, skeletons, card frames) and
are **not** duplicated (satisfies the similarity audit, spine §13).

---

## 7. Server/client boundary vs existing audits

The framework is SSR-first with a dependency audit that forbids bare `fetch` in business code and a
similarity/scope audit. The trade demo keeps both green by construction:

| Concern | Rule (repo) | How trade components satisfy it |
| --- | --- | --- |
| No bare `fetch` | dependency-audit fails on bare `fetch` in business code | fragments fetch data via `@mvp/data`; runtime does fragment HTTP via `@mvp/runtime` `fetchFragment` (already allowlisted); islands use `subscribeData` — no raw `fetch`. |
| Server-safe fragments | fragments are pure SSR services, no React-to-browser | fragments emit **HTML strings** (like `promotion-banner`), never ship React/Radix; islands are the only browser JS and live in the Next page app, not in fragments. |
| Next RSC island scope | repo scopes/allowlists `"use client"` islands inside `apps/page-*` (RSC island scope) | all trade islands live under `apps/page-trade/app/**` (and shell for chrome), matching the `RealtimeInsights` precedent; they import `@mvp/trade-client`, which is the single React entry. |
| React bundled once | spine §4/§11 | fragments declare `@mvp/trade-client` as a **shared asset** in `manifest.assets.js`; `@mvp/assets` dedupes it so React/Radix ship once, not per fragment. |
| Budgets are hard gates | spine §5/§13 | each fragment's `budget.ts` gates JS/CSS; keeping React out of fragments is what makes the realtime table fragments fit their `jsBytes`. |
| Contracts | Zod in `@mvp/contracts` | new render props + data payloads get Zod schemas (interaction channel payloads too — see 03). |

**Key invariant:** the SSR/island seam is *inside the page*, never inside a fragment. A fragment is
server-only HTML+CSS(+ a declared shared-JS reference); the page decides which `data-island` mount
points to hydrate through `@mvp/trade-client`. This preserves the audit posture unchanged.

---

## 8. Ownership matrix (non-overlapping; feeds 10-parallel-work-plan)

Each file/package has exactly one owning agent. No two agents write the same path. This is the
canonical ownership source that [10-parallel-work-plan.md](10-parallel-work-plan.md) sequences into
phases.

| Agent | Owns (paths) | Deliverable |
| --- | --- | --- |
| **A · design-system** | `packages/design-system/**`, `packages/design-tokens/src/index.ts` (add trade tokens from 01 §9) | tokens + Tailwind preset + base reset (spine §11) |
| **B · trade-client** | `packages/trade-client/**` | React bootstrap, shared client store (spine §7 slices), chart adapter, island mount API |
| **C · shell chrome** | `apps/shell-gateway/**` (nav/menu/wallet/theme/locale), `packages/ui/{AppNav,WalletMenu,ThemeToggle,LocaleSwitcher,CommandPalette,Tabs,Dialog,Tooltip,Slider,Toast}/**` | global chrome + vendored shadcn primitives (spine §4) |
| **D · trade page** | `apps/page-trade/**` (route container, `src/manifest*`, `src/fragmentSlots.ts`, island mount files under `app/**`) | page composition + island wiring |
| **E · markets/portfolio pages** | `apps/page-markets/**`, `apps/page-portfolio/**` | list + portfolio pages (single-page deploy example, spine §9) |
| **F · realtime-book fragments** | `fragments/order-book/**`, `fragments/trades-feed/**` | realtime ladder + tape fragments + islands' patch logic |
| **G · order/position fragments** | `fragments/order-form/**`, `fragments/positions-table/**`, `fragments/open-orders/**`, `fragments/account-bar/**` | order/account fragments |
| **H · market-data fragments** | `fragments/market-header/**`, `fragments/chart-panel/**`, `fragments/funding-bar/**`, `fragments/marketrail/**`, `fragments/markets-table/**` | near-realtime + ISR fragments |
| **I · portfolio fragments** | `fragments/portfolio-summary/**`, `fragments/pnl-chart/**` | portfolio fragments |
| **J · data layer** | `packages/data/**` (trade sources), `packages/interaction/**` (trade channels), mock `SubscriptionTransport`, Zod payloads in `packages/contracts/src/**` | data broker + interaction contracts (owns 03-data doc's code) |
| **K · registry/deploy** | `platform/fragment-registry/src/registry.data.json`, `platform/route-registry/**`, `infra/docker/**` **via scripts only** | registration/mount/promote runbooks (spine §9, §13) |
| **L · observability/trace UI** | `packages/observability/**`, trace-waterfall island/fragment | trace waterfall UI (spine §10) |

Shared-boundary rules (prevent write collisions):
- Fragment authors (F/G/H/I) **never** hand-edit `registry.data.json` or `manifest.slots.json`;
  registration/mount is agent **K** running `scripts/register-fragment.mts` / `mount-slot.mts`.
- Agent **B** owns the store slice *definitions*; fragment/page agents only *consume* them via the
  `@mvp/trade-client` API — they don't redefine slices.
- Agent **J** owns all data-source ids and interaction channel contracts; fragment agents reference
  ids (§3, §5) but don't define transports.
- Agent **A** owns tokens; everyone consumes CSS variables, no one hand-writes color hexes
  (spine §13).

---

## 9. Conflicts / spine-amendment requests

Additive only; none block architecture work:

1. **`marketrail` as a distinct fragment** — same open item as 01 §10.3. This doc assumes a distinct
   `fragments/marketrail` reusing `markets` data. *Request: spine §5 confirm/annotate.*
2. **`account` as a shared data node** — §4 relies on one `account` resolution feeding three slots to
   exercise the dedupe hint. Consistent with spine §6 ("account margin [request-time + realtime]")
   but the *sharing across three slots* should be blessed in §6. *Request: confirm.*
3. **`open-orders` covers order-history/funding views** — §2/§6/01 §10.4 assume `order-history` and
   the ledger `funding` tab are *views* of `open-orders`/`funding-bar`, not new fragments. *Request:
   confirm to keep the fragment count at the spine §5 list + `marketrail`.*
4. **`@mvp/trade-client` island mount API shape** — spine §11 names the package but not its API; this
   doc assumes `mountIsland(el, {props, slice})` + inline-JSON snapshot convention. *Request: 09-doc
   (shared-dependencies) to ratify the exact signature so fragment agents can emit matching markup.*

All realtime/SSR/island assignments, data classes, and cross-component flows here match spine
§4–§8; no behavioral divergence.
