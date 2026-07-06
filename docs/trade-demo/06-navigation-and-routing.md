# 06 — Navigation + Routing

Anchored to the [Trade Demo spine](README.md), §3 (page inventory + complex menu), with
dependencies on §2 (framework mapping / ports), §4 (shadcn island vs SSR boundary),
§7 (cross-component store — the `activeSymbol` slice), and §9 (deployment). When a detail
here conflicts with the spine, the spine wins until amended there.

This document specifies the **complex top nav / menu**, the **route-registry entries** and
`shell-gateway` composition, the **page shells** for each route, and the **command-palette
symbol quick-switcher**, including which pieces are shadcn islands vs pure SSR links, and
the seam to the shared trade store.

---

## 1. Complex menu spec (top nav)

### 1.1 Top bar wireframe (desktop, ≥1024px)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [◆ MVP Perps]  Trade  Markets  Portfolio  Vaults  Referrals  ⋯More │  [BTC ▾]  [🌐 EN ▾] [☾ ▾] [Connect ▾] │
│  brand/logo    ── primary nav (SSR <a>) ──────────  overflow   │  symbol   locale   theme  wallet          │
└──────────────────────────────────────────────────────────────────────────────────────┘
     link         active = aria-current, underline token          island   island   island  island
```

Left cluster is **pure SSR** (brand + primary nav links). Right cluster is a row of small
**islands** (symbol switcher, locale, theme, wallet) plus the **overflow "More"** island.

### 1.2 Element behaviors

| # | Element | Type | Behavior |
| --- | --- | --- | --- |
| 1 | Brand `◆ MVP Perps` | SSR `<a href="/">` | Link to `/` (redirects to `/trade/BTC`, §4.4). Our own mark/copy (spine IP boundary). |
| 2 | Primary nav: `Trade` `Markets` `Portfolio` `Vaults` `Referrals` | SSR `<a>` | Plain anchors to the route paths. Active item marked with `aria-current="page"` + token underline. No JS needed. `Trade` points at the last-viewed symbol (cookie) or `/trade/BTC`. |
| 3 | Overflow **⋯ More** | shadcn `DropdownMenu` island | Collapses low-priority items on narrow widths (Vaults, Referrals, Docs, Status). On desktop only appears if the primary row overflows (container-query check); items are still real `<a>`s inside the menu. |
| 4 | **Symbol quick-switch** `[BTC ▾]` | shadcn `Command` (command palette) island | Click or `⌘K`/`Ctrl-K` opens the palette (§2). Shows current `activeSymbol`; selecting a symbol drives the store + deep link. |
| 5 | **Locale** `🌐 EN ▾` | `LocaleSwitcher` island (05 doc) | Writes `mvp_locale` cookie, reloads. |
| 6 | **Theme** `☾ ▾` | `ThemeToggle` island (05 doc) | light / dark / system; flips `data-theme` instantly, no reload. |
| 7 | **Wallet / Connect** `[Connect ▾]` | shadcn `DropdownMenu` island | Disconnected: single "Connect" action (mock connect → sets mock session). Connected: dropdown with truncated address, equity summary, Copy address, Disconnect. All mock (spine: synthetic data). |

### 1.3 Responsive collapse

| Breakpoint (tokens `--mvp-breakpoint-*`) | Primary nav | Right cluster |
| --- | --- | --- |
| `≥ lg` (1024) | all 5 links inline | full row |
| `md` (768–1023) | `Trade Markets Portfolio` inline; `Vaults Referrals` → **More** | symbol + wallet visible; theme/locale → **More** |
| `< sm` (<640) | hamburger `DropdownMenu` holding all nav | symbol + wallet only; rest in hamburger |

The hamburger and **More** are the *same* shadcn `DropdownMenu` component instance-pattern,
just fed different item sets by breakpoint (container-query / CSS-driven visibility so the
SSR markup is stable and the island only enhances).

---

## 2. Command palette — symbol quick-switcher

### 2.1 Purpose

Fast keyboard switch of `activeSymbol` from anywhere. Backed by the global markets index
(shell-owned data, spine §6). Vendored shadcn `Command` (cmdk) rendered as an island via
`@mvp/trade-client`.

### 2.2 Interaction / keyboard map

| Key | Action |
| --- | --- |
| `⌘K` / `Ctrl-K` | Open palette (global listener on the shell island) |
| type query | Fuzzy filter over `symbol` + `name` (e.g. `bt` → BTC, `eth` → ETH) |
| `↑` / `↓` | Move highlight |
| `Enter` | Select highlighted symbol |
| `Esc` | Close, no change |
| `⌘1..9` (optional) | Jump to Nth watchlist symbol |

### 2.3 Palette wireframe

```
┌── ⌘K ─────────────────────────────────────────┐
│  🔍  bt|                                       │
├────────────────────────────────────────────────┤
│  Markets                                        │
│  ▸ BTC   Bitcoin        64,210.5   +1.2%        │  ← Enter selects
│    ETH   Ethereum        3,410.2   -0.4%        │
│    SOL   Solana            172.9   +3.1%        │
│  Recent                                         │
│    ARB   Arbitrum            1.02   +0.8%       │
└────────────────────────────────────────────────┘
```

Rows show mark price + 24h change from the shared ticker stream (near-realtime). Sections:
"Markets" (full index), "Recent" (from `@mvp/storage` recent-symbols).

### 2.4 On select — the flow (this is the store seam)

```
palette select("ETH")
   │ 1. publish to trade store  ──►  activeSymbol slice = "ETH"   (see §6, 03 doc)
   │ 2. deep-link update         ──►  history.pushState → /trade/ETH   (if already on trade page)
   │                                  or full navigation to /trade/ETH (if elsewhere)
   │ 3. persist                  ──►  @mvp/storage recent-symbols + last-symbol cookie
   └ 4. close palette
```

- On the **trade page**, selecting a symbol does **not** reload the shell chrome. It updates
  the `activeSymbol` store slice; chart/book/order-form islands resubscribe (spine §7) and
  the URL is patched via `pushState` for deep-linkability. Static shell nav does not
  re-render.
- From **any other page** (`/markets`, `/portfolio`), selecting navigates to `/trade/<sym>`
  (real navigation), where SSR renders that symbol as the first paint.

---

## 3. Routing

### 3.1 `RouteEntry` draft (extends `platform/route-registry/src/registry.ts`)

The existing `RouteEntry` shape is `{ id, path, page, serviceUrl, channel }` with
`matchRoute` supporting `:param` patterns (`matchesPathPattern`). New routes for the demo,
using the ports from spine §2:

| id | path | page | serviceUrl (default) | channel |
| --- | --- | --- | --- | --- |
| `home` (existing) | `/` | `@mvp/page-home` | `PAGE_HOME_URL` ?? `:4101` | stable |
| `trade` | `/trade/:symbol` | `@mvp/page-trade` | `PAGE_TRADE_URL` ?? `:4103` | stable |
| `markets` | `/markets` | `@mvp/page-markets` | `PAGE_MARKETS_URL` ?? `:4104` | stable |
| `portfolio` | `/portfolio` | `@mvp/page-portfolio` | `PAGE_PORTFOLIO_URL` ?? `:4105` | stable |
| `vaults` | `/vaults` | `@mvp/page-markets` (or `page-vaults`) | `PAGE_VAULTS_URL` ?? `:4104` | stable |
| `referrals` | `/referrals` | `@mvp/page-referrals` | `PAGE_REFERRALS_URL` ?? `:4106` | stable |

Illustrative addition to `routeRegistry.routes`:

```ts
{
  id: "trade",
  path: "/trade/:symbol",
  page: "@mvp/page-trade",
  serviceUrl: process.env.PAGE_TRADE_URL ?? "http://localhost:4103",
  channel: "stable",
},
{
  id: "markets",
  path: "/markets",
  page: "@mvp/page-markets",
  serviceUrl: process.env.PAGE_MARKETS_URL ?? "http://localhost:4104",
  channel: "stable",
},
```

### 3.2 Per-unit override conventions (serviceUrl / channel / env)

- **serviceUrl** always comes from an env var with a localhost default, matching the
  existing `PAGE_HOME_URL` pattern (`PAGE_<NAME>_URL`). This is how a canary page is pointed
  at a different host without a code change (deployment doc 07 / spine §9).
- **channel** (`stable | canary | preview`) is per route. A single-page deploy (spine §9)
  ships e.g. `/markets` on `canary` first — either as a second route entry that
  `matchRoute` can select, or by flipping the entry's `channel` + `serviceUrl` after smoke.
- `validateRouteRegistry` already enforces the invariants (`page` starts with `@mvp/`,
  `serviceUrl` starts with `http`, valid channel) — new entries must satisfy it.
- Fragment-level env overrides (`NEXT_SYMBOL_URL`-style, spine §9) are orthogonal: they
  live in the **fragment** registry, not here. Route registry is page-granularity only.

### 3.3 How `shell-gateway` matches + composes

From `apps/shell-gateway/src/server.ts`, the `/*` handler already:

1. Builds a `RequestContext` (carries `locale` + `theme`, per 05 doc) and a request trace.
2. Computes `pathname`, opens a `shell.route.match` span, calls `matchRoute(pathname)`.
3. On no match → 404 fallback (`createNotFoundFallback`).
4. On match → `shell.upstream.fetch` span, `fetch(\`${route.serviceUrl}${pathname}\`)`
   with `createFragmentHeaders(ctx)`, then `decorateShellHtml` injects the shell chrome
   marker (this is where the real top-nav chrome renders in the demo).

For the demo, the composition stays exactly this shape; the changes are:

- `/trade/:symbol` matches via the existing `:param` support; the shell forwards the full
  `pathname` (including `/trade/BTC`) so the page unit receives the symbol.
- The `decorateShellHtml` placeholder marker is replaced by the **real shell chrome** (top
  nav §1 + theme/i18n asset tags from 05 doc), rendered SSR by the shell, wrapped around
  the proxied page HTML. Primary nav + brand are SSR; the right-cluster islands' mount
  points are emitted with the CSP `nonce` already threaded through `createNonce` /
  `createContentSecurityPolicy`.
- CSP: island `<script>`s carry the per-request `nonce`; the asset plane already accepts
  `nonce` on every asset (05 doc), so nav islands are CSP-clean by construction.

### 3.4 Deep-linking symbols + default redirect

| Path | Result |
| --- | --- |
| `/trade/BTC` | SSR-render trade page with `activeSymbol=BTC` as first paint. Deep-linkable, shareable. |
| `/trade/eth` | Symbol normalized to upper (`ETH`) at the page unit; canonical redirect to `/trade/ETH` if desired. |
| `/trade` (no symbol) | Redirect → `/trade/<last-symbol cookie>` or `/trade/BTC`. |
| `/` | Redirect → `/trade/BTC` (demo home = trade). Handled by the `home` route/page returning a redirect, keeping route-registry declarative. |
| `/trade/UNKNOWN` | Page unit renders a "market not found" state (symbol not in index) rather than a shell 404 — the *route* matched, the *symbol* didn't. |

`activeSymbol` is thus sourced two ways that must agree: **URL path param** on SSR/navigation,
**store slice** on in-page switches. §6 defines the reconciliation.

---

## 4. Page shells

Each page unit renders its **content**; the **shell chrome** (top nav, theme/i18n assets,
footer) is owned by `shell-gateway` and wrapped around every page (spine §2). So a page
shell = "what fills the region under the top nav."

### 4.1 Shared chrome vs page content

| Layer | Owner | Contents |
| --- | --- | --- |
| Shell chrome | shell-gateway | Top nav (§1), command palette, theme/locale/wallet islands, global token/font/CSP, footer. Rendered once, same on every route. |
| Page content | page-unit | The route-specific slot layout below the nav. |

### 4.2 `/trade/:symbol` — headline page (page-trade, :4103)

Full layout is **01-ui-layout.md**; here just the slot skeleton (spine §5 fragments):

```
┌ market-header (mark/oracle/funding/24h) ───────────────────────────────┐
├──────────────────────────────┬──────────────┬─────────────────────────┤
│ chart-panel (island)         │ order-book   │ order-form (island)      │
│                              │ (patch)      │ (leverage slider island) │
├──────────────────────────────┤ trades-feed  │ account-bar              │
│ positions-table / open-orders (tabs island) │                          │
└──────────────────────────────┴──────────────┴─────────────────────────┘
funding-bar (near-realtime, SSR)
```

Slots: `marketHeader`, `chartPanel`, `orderBook`, `tradesFeed`, `orderForm`,
`positionsTable`, `openOrders`, `accountBar`, `fundingBar` — mounted via `mount-slot`
(CLAUDE.md lifecycle). Island boundary per spine §4.

### 4.3 `/markets` (page-markets, :4104)

```
┌ page title + search/filter (island: DataTable toolbar) ┐
├────────────────────────────────────────────────────────┤
│ markets-table  (near-realtime SSR rows + island sort)   │
│   Symbol | Mark | 24h% | Funding | Volume | ▸ (row → /trade/:symbol)
└────────────────────────────────────────────────────────┘
```

Single slot `marketsTable`. Row click = SSR `<a href="/trade/:symbol">` (deep link), no
store dependency. Doubles as the **single-page deploy** example (spine §9).

### 4.4 `/portfolio` (page-portfolio, :4105)

```
┌ portfolio-summary (equity, margin usage, PnL) — request-time SSR ┐
├───────────────────────────────────────────────────────────────────┤
│ Tabs (island): Positions | Open Orders | History                  │
│   positions-table (realtime patch) / order-history (request-time)  │
├───────────────────────────────────────────────────────────────────┤
│ pnl-chart (ISR, SSR image/canvas island)                          │
└───────────────────────────────────────────────────────────────────┘
```

Slots: `portfolioSummary`, `positionsTable` (reused fragment), `pnlChart`.

### 4.5 `/vaults` + `/referrals` — lightweight

```
/vaults      : page title + vaults list (static/ISR SSR cards, no realtime, no island)
/referrals   : static marketing-style page (copy + a mock referral code, SSR only)
```

These exist mainly to give the nav depth (spine §3). No fragments beyond a simple SSR
list; no islands except shared chrome. `/vaults` is a good **ISR** demonstration; both are
fully server-rendered.

---

## 5. Island vs SSR boundary in the menu (compliance)

Per spine §4 — shadcn/Radix only where interactivity earns its budget; everything else SSR.

| Menu piece | Rendering | Rationale |
| --- | --- | --- |
| Brand link | **SSR `<a>`** | Static navigation. |
| Primary nav links | **SSR `<a>`** | Static navigation, `aria-current` set server-side. |
| Overflow **More** / mobile hamburger | **island** — shadcn `DropdownMenu` | Needs open/close, focus trap, keyboard. Items inside are still real `<a>`. |
| Symbol quick-switch | **island** — shadcn `Command` | Fuzzy search, keyboard nav, live prices. |
| Locale switcher | **island** — `LocaleSwitcher` (05) | Writes cookie + reload. |
| Theme toggle | **island** — `ThemeToggle` (05) | Flips `data-theme`. |
| Wallet / Connect | **island** — shadcn `DropdownMenu` | Stateful (connected/disconnected), dropdown. |
| Footer links | **SSR `<a>`** | Static. |

Budget rule (spine §4/§13): all islands hydrate through the single `@mvp/trade-client`
runtime so React/Radix ship **once**, not per menu item. The SSR links carry **zero** JS.
No island owns first paint of navigation — the links are usable before hydration.

---

## 6. Seam with the cross-component store (`activeSymbol`)

This is the alignment point with **03-data-architecture.md** (store slices) and spine §7.

### 6.1 Two sources of truth, reconciled

`activeSymbol` can change from:

1. **URL** — first paint / real navigation (`/trade/:symbol` param → SSR seeds the store).
2. **In-page switch** — command palette (§2) or a book/markets interaction.

Reconciliation rule:

```
SSR (page-trade)  : read :symbol from path  ──► seed trade store activeSymbol = <symbol>
                                              ──► inline seed so island hydrates with it (no flash)

In-page switch    : palette/select publishes activeSymbol
                    ──► chart/book/form/positions islands resubscribe (@mvp/data)
                    ──► history.pushState("/trade/<newSymbol>")   // URL follows store, stays deep-linkable
                    ──► static shell nav does NOT re-render

Back/forward       : popstate ──► read path param ──► set activeSymbol slice (URL drives store)
```

- **URL is the durable identity**, the store slice is the live runtime value; `pushState`
  on in-page switches and `popstate` on nav keep them in lock-step without reloading the
  shell.
- The shell top nav's symbol indicator (`[BTC ▾]`) **subscribes** to the `activeSymbol`
  slice so its label updates on in-page switches — but it's a lightweight island read, not
  a shell re-render (spine §7: "static shell chrome does NOT re-render").

### 6.2 Channel/store details deferred to 03

The concrete channel name, payload schema, and store implementation for `activeSymbol`
live in **03-data-architecture.md** (built on `@mvp/interaction` typed channels + the
`packages/trade-client` client store, mirroring the existing
`apps/page-home/src/interactionContracts.ts` contract pattern). This doc only fixes the
**navigation-side contract**: palette/nav publish `activeSymbol`; URL and store stay
synchronized via `pushState`/`popstate`; SSR seeds from the path param.

---

## 7. Acceptance checklist for this area

- [ ] Route-registry has `trade` (`/trade/:symbol`), `markets`, `portfolio`, `vaults`,
      `referrals` entries; each with `PAGE_<NAME>_URL` env + localhost default;
      `validateRouteRegistry` passes.
- [ ] `shell-gateway` matches `/trade/:symbol` via existing `:param` support and forwards
      the symbol; real shell chrome replaces the placeholder marker; CSP nonce threaded to
      nav islands.
- [ ] Top nav: brand + primary links are SSR `<a>` (zero JS, `aria-current` server-side);
      More/hamburger, symbol switch, locale, theme, wallet are islands via
      `@mvp/trade-client` (React shipped once).
- [ ] Command palette opens on `⌘K`/`Ctrl-K`, fuzzy-filters the markets index, `Enter`
      selects; on trade page it `pushState`s + updates store without shell re-render, from
      elsewhere it navigates to `/trade/<sym>`.
- [ ] Deep link `/trade/BTC` SSR-renders that symbol; `/` and `/trade` redirect to a
      default/last symbol; unknown symbol → page-level not-found, not shell 404.
- [ ] Each page shell renders only its slots under the shared chrome; markets/portfolio/
      vaults/referrals skeletons match §4; `/markets` reused as the single-page deploy
      example.
- [ ] `activeSymbol` reconciles URL ↔ store via `pushState`/`popstate`; nav symbol
      indicator subscribes without re-rendering the shell; channel/schema owned by 03 doc.
