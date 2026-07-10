# Trade Demo — Master Plan (Spine)

Last updated: 2026-07-06

This is the **single source of truth** for the perpetuals trading demo built on top of
the `ai-first-web-frame`. Every detailed area document (see [Document set](#12-document-set))
anchors to the decisions here. Parallel agents MUST read this file first, then their
assigned area doc. When a detail conflicts, this spine wins until it is amended here.

## 1. What we are building

A **perpetuals DEX trading interface**, structurally modeled on the layout and
interaction conventions of a modern perps trading terminal (the reference being the
Hyperliquid BTC trade screen), rebuilt as a showcase of the framework's capabilities.

### Scope / IP boundary (read this)

- We replicate **layout structure, panel composition, and interaction patterns** — these
  are industry-standard trading-UI conventions (order book, depth, order form, positions
  table, funding bar, TradingView-style chart region).
- We do **NOT** copy proprietary assets: no Hyperliquid logo, brand marks, exact wording,
  color palette, or copied screenshots/SVGs. Our brand is **"MVP Perps"**, our own copy,
  our own design tokens. All market data is **synthetic/mock** (deterministic generators +
  a mock realtime transport), never a live feed.
- "1:1 replica" therefore means **structural/behavioral fidelity**, not asset-level copying.

### Why this demo

The demo exercises every framework capability end to end, in a domain (realtime trading)
that stresses exactly the parts the framework is built for: realtime vs non-realtime data
classification, cross-component store sharing, SSR + client islands, per-component
deployment, and trace-driven performance work.

## 2. Framework mapping (how trading concepts land on the framework)

| Framework unit | Port(s) | Owns in this demo |
| --- | --- | --- |
| `apps/shell-gateway` | 4100 | Global chrome: top nav + complex menu, wallet/connect control, theme toggle, locale switcher, global tokens/fonts/CSP, route composition. Global data: markets index, session. |
| `apps/page-trade` (new) | 4103 | `/trade/:symbol` route container; page layout manifest; page data (active-symbol metadata, candles bootstrap); slot composition of trade fragments. |
| `apps/page-markets` (new) | 4104 | `/markets` list page (single-page deploy example). |
| `apps/page-portfolio` (new) | 4105 | `/portfolio` positions/balances page. |
| `fragments/*` (new) | 4201+ | Independently deployable SSR business components (see §5). |
| `@mvp/data` | — | Data broker: realtime subscriptions, cached/ISR/request-time reads, dedupe. |
| `@mvp/interaction` | — | Cross-component shared trade store (active symbol, order draft, hovered price). |
| `@mvp/storage` | — | Watchlist, layout prefs, recent symbols, theme+locale persistence. |
| `@mvp/observability` | — | Per-fragment + per-data-dependency trace; metrics; the richer trace waterfall UI. |
| `@mvp/assets` | — | Theme (light/dark token sets), i18n namespaces, CSS/JS/font order + dedupe. |
| `packages/ui` + shadcn | — | Shared UI primitives (see §4). |
| `packages/design-system` (new) | — | Shared tokens + Tailwind preset + base reset consumed by shell/pages/fragments. |
| `packages/trade-client` (new) | — | Shared client-island runtime (React bootstrap + interaction store client + chart adapter) split out so each island doesn't re-bundle it. |

## 3. Page inventory (different pages + complex menu)

Primary: **Trade** (`/trade/:symbol`, default `BTC`). Secondary pages give the nav real
depth (the "complex menu" requirement):

- `/trade/:symbol` — the terminal (headline page, most components).
- `/markets` — sortable/filterable markets table; row click → trade page.
- `/portfolio` — positions, balances, order history, PnL summary.
- `/vaults` — (lightweight) list page, exists to populate the menu + show a static/ISR page.
- `/referrals` — (lightweight) static page.
- Menu also carries: theme toggle, locale switcher, wallet/connect dropdown, a "more"
  overflow menu, and a symbol quick-switcher (command-palette style).

Routing goes through `packages/routes` (`@mvp/routes`); each page is a separate deployable unit.

## 4. shadcn/ui integration decision (the crux)

**Problem.** shadcn/ui assumes Tailwind CSS + Radix UI + React client components. The
framework today has **no Tailwind** — it uses CSS Modules + design-token CSS variables and
is **SSR-first with server-safe components** and hard per-unit JS/CSS budgets.

**Decision (hybrid, elaborated in [04-shadcn-and-styling.md](04-shadcn-and-styling.md)):**

1. Introduce **Tailwind as a build-time tool scoped to client-island UI**, with its theme
   mapped onto our **existing design tokens as the single source of truth** (Tailwind
   `theme.extend` reads CSS variables from `@mvp/design-tokens`). No divergent color system.
2. Use **shadcn + Radix primitives only for genuinely interactive chrome** rendered as
   **client islands**: dropdown menu, command palette, dialog, tabs, select, tooltip,
   slider (leverage), toggle. These are vendored (shadcn is copy-in source, not a runtime
   dep) into `packages/ui` and restyled to our tokens.
3. Keep **high-frequency data panels SSR** (order book rows, trades feed, positions table)
   emitting **token-based CSS from fragments**, NOT React/Radix — this protects the fragment
   JS budgets and keeps first paint server-rendered. Realtime updates patch these via the
   island runtime, not via re-rendering Radix trees.
4. The shared `packages/trade-client` island runtime is the ONLY place React ships to the
   browser; every island mounts through it so React/Radix are bundled once.

This gives shadcn where it earns its weight (interactive menus/dialogs) without abandoning
the SSR/budget model that the rest of the framework depends on.

## 5. Component decomposition (business fragments + shared UI)

Each **fragment** is an independently deployable SSR service (`/health`, `/manifest`,
`/assets`, `/render`, `/metrics`) with its own budget. Islands hydrate specific interactive
sub-parts.

Trade-page fragments:

| Fragment | Data class | Realtime? | Island? | Notes |
| --- | --- | --- | --- | --- |
| `market-header` | ticker/mark/funding | near-realtime | small | pair, mark/oracle price, 24h change, funding, volume, countdown |
| `chart-panel` | candles | near-realtime + ISR history | yes | TradingView-style region; mock candle series + interval control |
| `order-book` | L2 book | **realtime** | patch-only | bid/ask ladder, depth bars, spread; row click → shared store |
| `trades-feed` | prints | **realtime** | patch-only | recent trades tape |
| `order-form` | account/margin | request-time + realtime margin | yes | market/limit, size, leverage slider, buy/sell, reduce-only |
| `positions-table` | positions | **realtime** | patch-only | size, entry, mark, liq, uPnL, close controls |
| `open-orders` | orders | realtime/request-time | patch-only | working orders, cancel |
| `account-bar` | balances/margin | request-time + realtime | small | equity, margin usage, withdrawable |
| `funding-bar` | funding/oracle | near-realtime | no | funding schedule, next-funding countdown |

Markets/portfolio fragments: `markets-table` (near-realtime), `portfolio-summary`
(request-time), `pnl-chart` (ISR). Shared UI (packages/ui via shadcn): `AppNav`,
`WalletMenu`, `ThemeToggle`, `LocaleSwitcher`, `CommandPalette`, `DataTable`, `Tabs`,
`Dialog`, `Tooltip`, `Slider`, `Toast`.

## 6. Data architecture (global / page / component × realtime / non-realtime)

Full detail in [03-data-architecture.md](03-data-architecture.md). Summary:

- **Global data** (shell-owned): markets index + ticker stream [near-realtime], session/
  wallet [request-time], global funding [near-realtime].
- **Page data** (page-owned): active-symbol metadata [ISR], candle history [ISR] + live
  candle [near-realtime], leverage tiers [static/ISR].
- **Component data** (fragment-owned): order book L2 [realtime], trades [realtime],
  positions [realtime], open orders [realtime], account margin [request-time + realtime].
- **Freshness → render strategy:** static/ISR data → SSR HTML; realtime → SSR initial
  snapshot + island patch via `subscribeData`; request-time → SSR per request.
- **Realtime transport:** a mock `SubscriptionTransport` (deterministic generator, seeded)
  standing in for a WebSocket feed; the interface is production-swappable to WS/SSE.

## 7. Cross-component store sharing

Detail in [03-data-architecture.md](03-data-architecture.md). The trade page has a shared
**client store** whose slices are: `activeSymbol`, `orderDraft` (side/price/size/leverage/
reduceOnly), `chartInterval`, `hoveredPrice`, `bookGrouping`. It is implemented on
`@mvp/interaction` typed channels + a small client store in `packages/trade-client`.
Canonical flows to demonstrate:

- Click an order-book row → publishes `orderDraft.price` → order-form island updates,
  WITHOUT re-rendering the SSR page or other fragments.
- Change leverage slider → broadcasts to account-bar + order-form margin preview.
- Symbol switch in command palette → updates activeSymbol → chart + book + form resubscribe;
  static shell chrome does NOT re-render.

## 8. i18n + theming

Detail in [05-i18n-and-theming.md](05-i18n-and-theming.md). Locales: `en`, `zh` (min set,
extensible). Namespaces per surface (nav, trade, markets, portfolio). Theme: `light`,
`dark`, `system` via **two token sets** in `@mvp/design-system` injected as CSS variables
by `@mvp/assets`; Tailwind + shadcn read the same variables so islands theme automatically.
Persistence via `@mvp/storage` (cookie for SSR-correct first paint, no flash).

## 9. Deployment examples (both required)

Detail in [07-deployment-examples.md](07-deployment-examples.md).

- **Single-page deploy:** ship `/markets` as its own release — new route in route-registry,
  canary channel, smoke, promote — without redeploying trade. Demonstrates page-level
  independent deploy + rollback.
- **Single-component deploy:** ship the `order-book` fragment independently via the existing
  lifecycle: `create-component` → implement/TDD → `register-fragment` (canary, own port) →
  `mount-slot` into the trade page → verify → `promote-fragment` / `rollback-fragment`,
  with `NEXT_SYMBOL_URL`-style env override + registry channel routing.

## 10. Observability + trace UI upgrade

Detail in [08-observability-and-trace-ui.md](08-observability-and-trace-ui.md). The current
trace surface is a `<pre>` JSON dump — **too simple**. Plan a real **trace waterfall UI**:
a dedicated island/fragment that renders, from the trace JSON + `/metrics`:

- A Gantt-style **span timeline** (scheduler → slot → data → network → cache lanes), with
  duration bars, start offsets, and critical-path highlighting.
- **Cache hit/miss** and **realtime-subscription** lanes color-coded.
- **Budget overlays** (per fragment/page) and **scheduler hints** (waterfall/duplicate-data)
  surfaced inline, linking to the optimizer findings.
- A **dependency graph** view (nodes = slots/data, edges = dependsOn).

This turns the trace from a debug dump into a performance-analysis tool, and doubles as the
demo's proof that the framework's optimization loop is real.

## 11. Shared CSS/JS dependency strategy

Detail in [09-shared-dependencies.md](09-shared-dependencies.md). Two shared packages:
`@mvp/design-system` (tokens + Tailwind preset + base reset CSS — one CSS source for all
units) and `@mvp/trade-client` (React island bootstrap + interaction store client + chart
adapter — one JS chunk shared by all islands, referenced via `@mvp/assets` so fragments
declare it as a shared dependency instead of re-bundling). `@mvp/assets` governs load
order, dedupe, SRI, and budget attribution across shell/page/fragment.

## 12. Document set

Spine = this file. Detailed docs (each drafted independently; file owner in parens):

| Doc | Scope |
| --- | --- |
| [01-ui-layout.md](01-ui-layout.md) | 1:1 layout decomposition: grid regions, every panel, responsive/breakpoints, panel→component map, ASCII wireframes. |
| [02-component-architecture.md](02-component-architecture.md) | Fragment + island + shared-UI boundaries, render/hydration contract, props/manifest per component, ownership matrix. |
| [03-data-architecture.md](03-data-architecture.md) | Data sources, freshness classes, dedupe/cache, the shared client store, interaction channels + payload contracts. |
| [04-shadcn-and-styling.md](04-shadcn-and-styling.md) | Tailwind+shadcn integration, token bridge, island vs SSR styling, budget impact, component vendoring list. |
| [05-i18n-and-theming.md](05-i18n-and-theming.md) | Locale/namespace layout, theme token sets, no-flash SSR, persistence, RTL note. |
| [06-navigation-and-routing.md](06-navigation-and-routing.md) | Complex menu spec, route registry entries, page shells, command palette, deep-linking symbols. |
| [07-deployment-examples.md](07-deployment-examples.md) | Step-by-step single-page and single-component deploy/rollback runbooks mapped to existing scripts. |
| [08-observability-and-trace-ui.md](08-observability-and-trace-ui.md) | Trace waterfall UI spec, data model, span lanes, budget/hint overlays, wireframes. |
| [09-shared-dependencies.md](09-shared-dependencies.md) | design-system + trade-client packages, asset-plane wiring, dedupe/SRI, budget attribution. |
| [10-parallel-work-plan.md](10-parallel-work-plan.md) | Phases, agent ownership matrix (non-overlapping files), inter-agent contracts, milestones, acceptance gates. |

## 13. Global rules for all trade-demo work

- All repo hard rules still apply: pnpm only, Vitest, Zod contracts, `pnpm verify` is the
  gate, budgets are hard fails, no bare `fetch` in business code, biome formatting, English
  code/comments/docs, registry/manifest edits via scripts.
- Market data is **synthetic**; no live external feeds; the realtime transport is mock but
  interface-swappable.
- Every new fragment ships with contract + tests + budget + `/metrics` + trace spans + a
  `/health` route, per the fragment lifecycle in the root `CLAUDE.md`.
- Islands hydrate through `@mvp/trade-client` only; React is not bundled per fragment.
- Keep the SSR-first posture: server-render first paint; islands patch, they don't own first
  render of data panels.

## 14. Ratified decisions & amendments (2026-07-06)

The area docs (01–10) surfaced a recurring set of cross-cutting questions. They are resolved
here authoritatively; this section overrides any area doc that disagrees. Each resolution
names the docs affected.

### D1. Tailwind: adopt (hybrid) — RATIFIED
Introduce Tailwind as a **build-time-only** tool scoped to client islands, with `theme.extend`
reading `@mvp/design-system` CSS variables as the single color/spacing source. SSR data panels
stay on token CSS (no Tailwind runtime, no Radix). Rejected alternative (recorded): plain CSS
Modules over the same tokens — dropped because shadcn/Radix interactive primitives are worth
the scoped Tailwind. Affects: 04, 09.

### D2. Chart renderer: custom canvas in `@mvp/trade-client` — RATIFIED
Ship a **self-contained lightweight canvas candle/depth renderer** inside `@mvp/trade-client`
(no external charting dependency). Rationale: keeps the offline/minimal-dep posture, predictable
bundle (~15–25 KB est.), synthetic data anyway. Alternatives noted for a future richer chart:
`uPlot` or `lightweight-charts` (each ~40–45 KB, would need dependency-audit sign-off). Affects:
01, 02, 04, 09; unblocks the chart agent slot.

### D3. Shared-chunk budget attribution — RATIFIED
The shared `@mvp/trade-client` JS chunk and the `@mvp/design-system` CSS are counted **once
against the page `stats.json`** and **excluded from each fragment's stats** (fragments *declare*
them as shared assets, they don't re-bundle). Bundle/CSS budget tooling must attribute by this
rule so fragments don't falsely fail their 30 KB/10 KB budgets. Affects: 02, 04, 09, and the
budget-audit tooling.

### D4. Island mount contract — RATIFIED
`@mvp/trade-client` exposes `mountIsland(el, { props, slice })`. Fragments emit a mount node
`<div data-island="<name>">` plus an adjacent `<script type="application/json">` carrying the
SSR snapshot/props. This markup contract is frozen (C-level); all fragment agents emit matching
markup. Full signature is specified in 09; 02 island table conforms. Affects: 02, 08, 09.

### D5. Store ownership & the `activeSymbol` seam — RATIFIED
- The **symbol switcher / command palette is a page-owned publisher** (page-trade), NOT shell
  chrome — otherwise "shell doesn't re-render on symbol switch" (flow C) breaks.
- **Theme and locale are shell-owned** cookie prefs on `shell.theme` / `shell.locale`
  interaction channels, NOT part of the trade store.
- The canonical `activeSymbol` channel name + Zod payload schema live in **03** (data doc);
  06 consumes them. URL ↔ store stay in lockstep via `pushState`/`popstate`; SSR seeds from
  the path param. Affects: 03, 05, 06.

### D6. New design tokens — RATIFIED (owned by `@mvp/design-system`)
Add to `@mvp/design-system`: trade grid track widths, `--trade-font-mono`, `--trade-buy` /
`--trade-sell` semantic colors (per theme), and `zIndex.sticky` (current tokens only have
base/overlay/modal). These are the single source Tailwind + SSR panels both read. Affects:
01, 02, 04, 05.

### D7. Fragment inventory clarifications — RATIFIED
- `marketrail` (mini market strip) is a **thin view over `markets-table` data**, not a
  separate data source; may be its own fragment for deploy independence but reuses the source.
- `order-history` and the ledger `funding` tab are **tabbed views** of `open-orders` /
  `funding-bar`, not new fragments/sources.
- The `account` data node is **intentionally shared across 3 slots** (order-form, account-bar,
  positions) to exercise the runtime dedupe hint — blessed.
Affects: 01, 02, 03.

### D8. `trace-inspector` is a deployable fragment — RATIFIED
The trace waterfall UI (doc 08) ships as a **new deployable fragment** `trace-inspector`
(props `{ traceDir?, traceId?, live? }`, reads `reports/traces/*.jsonl` via the optimizer's
`loadTraceSnapshots` + `/metrics`), hydrated as one island through `@mvp/trade-client`, styled
via design-system tokens, with an explicitly **wider-but-declared JS budget** (it is a tooling
page). Implementer adds `packages/observability/src/traceView.ts` (pure projector) + test. It
is the **second single-component-deploy example** candidate. Add to the 02 ownership matrix and
09 shared-dep list. Affects: 02, 07, 08, 09.

### D9. Asset-plane & source-id enumeration — RATIFIED
- A dedicated **`A0-assets` agent slot** owns the `@mvp/assets` wiring (load order, dedupe,
  SRI, budget attribution) to keep file boundaries clean; not split across UI/theming slots.
- All data **source ids** (including session/wallet request-time and the command-palette symbol
  index) are enumerated canonically in **03**; other docs reference, never redefine. Affects:
  03, 09, 10.

### Contract-freeze order (must be frozen before fragment agents fan out)
C1 design tokens (D6) · C2 island mount contract (D4) · C3 store-slice InteractionContracts +
`activeSymbol` (D5, in 03) · C4 fragment manifest/span shape · C5 data source-id naming (D9) ·
C6 `RouteEntry` set · C7 shared-chunk asset ids + budget rule (D3). Freeze C1–C7, then the
per-fragment agents (02 ownership matrix, slots A–L) run in parallel.
