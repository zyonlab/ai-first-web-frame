# 01 — UI Layout (1:1 Layout Decomposition)

> Anchored to [README.md](README.md) spine; **layout/behavior fidelity only, no proprietary assets** —
> we replicate industry-standard perps-terminal *structure and interaction*, using our own
> **MVP Perps** brand, `@mvp/design-tokens` values, and synthetic mock data. No logo, palette,
> wording, or SVG is copied from any reference product.

Last updated: 2026-07-06 · Owner: layout agent · Spine sections referenced: §1, §3, §5, §7, §8.

---

## 0. How to read this doc

- Every visual region below maps to exactly **one** unit from spine §5 (a fragment, an island, or a
  shared-UI primitive). The authoritative region→component table is [§4](#4-pan--component-mapping).
- Sizing is expressed in **design tokens** (`@mvp/design-tokens` `tokens.spacing/radius/breakpoint`)
  so no hard-coded pixels leak into fragments. The token set today:
  `spacing.xs=4 sm=8 md=16 lg=24 xl=40`, `radius.sm=4 md=8 lg=12`,
  `breakpoint.sm=640 md=768 lg=1024`. Where a value is not yet a token (grid track widths,
  monospace row height) it is flagged **[NEW TOKEN]** and listed in [§9](#9-new-tokens-required).
- ASCII wireframes are the contract for grid *topology*; pixel widths in them are illustrative.

---

## 1. Trade terminal — grid regions

The trade page (`apps/page-trade`, spine §3) is one top-level CSS Grid. The page shell owns the
grid; each cell is filled by a fragment's SSR HTML (injected via `dangerouslySetInnerHTML`, the
existing pattern in `apps/page-home/app/page.tsx`) or by an island mount point.

### 1.1 Named grid template (desktop, ≥1024px)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ topbar          (global chrome: AppNav · symbol quick-switch · wallet · theme · locale)│  56px
├───────────────┬───────────────────────────────────┬──────────────┬────────────────────┤
│               │  market-header (mark/oracle/24h/    │              │                    │
│  marketrail    │   funding/volume/countdown)        │  book        │   form             │
│  (pair picker  ├───────────────────────────────────┤  (order-book │  (order-form:      │
│   + watchlist  │                                    │   ladder +   │   mkt/limit,       │
│   sidebar)     │  chart-panel                       │   depth bars │   size,            │
│               │  (TradingView-style region +        │   + spread)  │   leverage slider, │
│               │   interval control)                 │              │   buy/sell)        │
│  240px        │                                    ├──────────────┤                    │
│               │                                    │  trades      │   account-bar      │
│               │                                    │  (prints     │   (equity/margin/  │
│               │                                    │   tape)      │    withdrawable)   │
├───────────────┴───────────────────────────────────┴──────────────┴────────────────────┤
│ ledger:  [ Positions ] [ Open Orders ] [ Order History ] [ Funding ]   ← tabbed panel  │
│   positions-table / open-orders (patch-only realtime tables)                           │  flex
├────────────────────────────────────────────────────────────────────────────────────────┤
│ funding-bar / status strip  (next-funding countdown · connection · mock-feed badge)    │  32px
└────────────────────────────────────────────────────────────────────────────────────────┘
   340px min          fluid (1fr)                        300px          320px
```

### 1.2 `grid-template-areas` (authoritative)

```css
.trade-grid {
  display: grid;
  grid-template-columns:
    var(--trade-col-rail)   /* 240px  [NEW TOKEN] */
    minmax(340px, 1fr)      /* chart column, fluid */
    var(--trade-col-center) /* 300px  [NEW TOKEN] */
    var(--trade-col-form);  /* 320px  [NEW TOKEN] */
  grid-template-rows:
    var(--trade-row-topbar) /* 56px */
    auto                    /* market-header */
    1fr                     /* chart / book / trades / form body */
    minmax(180px, 30vh)     /* ledger tabs */
    var(--trade-row-status);/* 32px */
  grid-template-areas:
    "topbar   topbar   topbar   topbar"
    "rail     header   book     form"
    "rail     chart    trades   form"
    "ledger   ledger   ledger   ledger"
    "status   status   status   status";
  gap: var(--mvp-spacing-xs); /* 4px seams — dense terminal look */
  height: 100dvh;
}
```

Notes:
- `book` and `trades` share the third column and stack vertically (book on top ~60%, trades ~40%).
  This matches the reference convention of order book above the trade tape.
- `form` spans two body rows (order-form on top, account-bar docked at its foot).
- The ledger row is a single full-width tabbed panel (§1.5).

### 1.3 Row/scroll/density spec per region

| Region | Fill | Scroll | Density | Height rule |
| --- | --- | --- | --- | --- |
| `topbar` | global chrome (shell) | none | comfortable | fixed 56px |
| `rail` (marketrail) | fragment | y-scroll list | compact rows 28px | full column |
| `header` (market-header) | fragment | none | single dense row, wraps at md | auto (~64px) |
| `chart` (chart-panel) | fragment + island | none (chart internal) | n/a | fills row `1fr` |
| `book` (order-book) | fragment, patch island | y-scroll, centered on spread | **high-density mono rows, 20px** | 60% of center col |
| `trades` (trades-feed) | fragment, patch island | y-scroll (newest top) | mono rows 20px | 40% of center col |
| `form` (order-form) | fragment + island | y-scroll if overflow | comfortable controls | grows to fill |
| `account-bar` | fragment, small island | none | 2–3 stat rows | docked ~96px |
| `ledger` (positions/orders) | fragment, patch island | x-scroll table + y-scroll body | mono cells 24px | `minmax(180px,30vh)` |
| `status` (funding-bar) | fragment | none | single strip | fixed 32px |

### 1.4 Order-book density spec (highest-fidelity panel)

The order book is the densest surface and the one most stressing the SSR-snapshot + island-patch
seam. Spec:

```
        order-book (center column, top)
  ┌────────────────────────────────────────────┐
  │  Price(USD)    Size(BTC)     Total          │  header row, 20px, muted, uppercase 10px
  ├────────────────────────────────────────────┤
  │▓▓▓▓▓▓ 64,120.5   0.842     12.84 ▓▓ ask     │  ask rows: depth bar fills from RIGHT
  │▓▓▓▓   64,119.0   0.310     12.00 ▓          │   color = --trade-sell (red family)
  │▓▓     64,118.5   0.115     11.69 ▓          │
  ├────────────────────────────────────────────┤
  │  spread 2.0 (0.003%)          mid 64,117.5  │  spread strip, 24px, centered
  ├────────────────────────────────────────────┤
  │▓      64,117.0   0.220      0.22 ▓▓ bid      │  bid rows: depth bar fills from LEFT
  │▓▓▓    64,116.0   0.540      0.76 ▓▓▓▓        │   color = --trade-buy (green family)
  │▓▓▓▓▓  64,115.5   1.120      1.88 ▓▓▓▓▓▓      │
  └────────────────────────────────────────────┘
```

- **Rows**: fixed 20px height, `font: var(--trade-font-mono)` **[NEW TOKEN]** (tabular-nums,
  ui-monospace), `font-size: 11px`, `line-height: 20px`. Right-aligned numeric columns.
- **Depth bars**: a per-row background gradient sized by `cumulativeSize / maxCumulative`,
  rendered as an inline `style="--depth: NN%"` width on a `::before` pseudo-element so the bar is
  pure CSS (no JS, protects fragment JS budget). Ask depth fills right→left, bid depth left→right.
- **Grouping**: tick-size grouping selector (0.5 / 1 / 5 / 10) lives in the panel header; it writes
  `bookGrouping` to the shared store (spine §7) and the island re-buckets rows client-side.
- **Patch model**: SSR renders the initial ladder snapshot; the island replaces row cells' text and
  the `--depth` var in place (keyed by price level), never re-rendering the whole `<table>`.

### 1.5 Ledger (positions / orders) tabbed panel

```
┌ ledger ─────────────────────────────────────────────────────────────────────┐
│ [Positions ●3] [Open Orders 1] [Order History] [Funding]        [Hide ▸]     │  Tabs (island)
├──────────────────────────────────────────────────────────────────────────────┤
│ Symbol  Side  Size   Entry     Mark      Liq.     uPnL      Margin   [Close]  │  header
│ BTC     LONG  0.50   63,900.0  64,117.5  58,110   +108.75   1,204    [×] [x½] │  mono 24px rows
│ ETH     SHORT 4.20   3,410.2   3,398.7   3,980    +48.30    980      [×] [x½] │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Tab bar is a **shadcn Tabs** island (spine §4/§5). Tab *bodies* are SSR fragment tables
  (`positions-table`, `open-orders`) patched by realtime islands.
- Table is horizontally scrollable inside its own `overflow-x:auto` container (never scrolls the
  page). uPnL cell colored by sign (`--trade-buy` / `--trade-sell`).
- Row action buttons (`Close`, `Close ½`) publish an `orderDraft` reduce-only intent to the store.

---

## 2. Responsive breakpoint behavior

Using existing `tokens.breakpoint` (sm 640 / md 768 / lg 1024). Trade terminal collapses columns as
width drops; markets/portfolio are simpler and mostly reflow.

### 2.1 Desktop `≥ lg (1024px)` — four-region body

Full grid from §1.2. All panels visible simultaneously.

### 2.2 Tablet `md–lg (768–1023px)` — two columns, book/trades/form become a right stack

```
grid-template-areas:
  "topbar  topbar"
  "header  header"
  "chart   rightstack"   /* rightstack = book/trades/form as internal Tabs */
  "ledger  ledger"
  "status  status";
grid-template-columns: minmax(320px,1fr) 340px;
```
- `marketrail` collapses into the topbar symbol quick-switch (drawer on demand) — the persistent
  rail is hidden below `lg`.
- `book`, `trades`, `form` are merged into a **right-stack Tabs island** (`[Book][Trades][Trade]`)
  so only one is visible at a time; the account-bar docks under whichever tab is active or moves to
  the status area.

### 2.3 Mobile `< md (768px)` — single column, fully tab-folded

```
┌ topbar (logo · symbol · wallet) ─────────────┐
│ market-header (mark · 24h · funding)          │
│ chart-panel (interval chips, reduced height)  │
│ ── sticky segmented control ────────────────  │
│ [ Chart ][ Book ][ Trades ][ Positions ]      │  ← primary segmented Tabs island
│ (active panel body)                           │
│ ── sticky bottom bar ───────────────────────  │
│ [  Buy / Long  ]        [  Sell / Short  ]    │  ← opens order-form sheet (Dialog island)
└───────────────────────────────────────────────┘
```
- Order form is a **bottom sheet** (shadcn Dialog island) opened by the sticky Buy/Sell bar.
- Order book renders **fewer levels** (top 8 each side) to hold the fragment budget on mobile.
- All tables become horizontally scrollable single-column-priority (Symbol + uPnL frozen).

### 2.4 Breakpoint matrix

| Region | ≥1024 (lg) | 768–1023 (md) | <768 (sm/mobile) |
| --- | --- | --- | --- |
| marketrail | persistent sidebar | drawer via topbar | drawer via topbar |
| market-header | one dense row | wraps to 2 rows | 2 rows, fewer stats |
| chart-panel | full | full width, top | reduced height |
| order-book | dedicated column | right-stack tab | segmented tab, 8 levels |
| trades-feed | under book | right-stack tab | segmented tab |
| order-form | dedicated column | right-stack tab | bottom-sheet Dialog |
| account-bar | docked under form | under active tab | inside form sheet |
| positions/orders | full ledger tabs | full ledger tabs | segmented tab |
| funding-bar | status strip | status strip | folded into header |

---

## 3. Interaction states

| Interaction | Region | Visual state | Store / bus effect (spine §7) |
| --- | --- | --- | --- |
| **Hover order-book row** | order-book | row bg lifts to `--trade-row-hover`; cumulative-total tooltip; depth bar brightens | publishes `hoveredPrice` — chart draws a faint price guide line |
| **Click order-book row** | order-book | brief `--trade-flash` highlight on the clicked price | publishes `orderDraft.price` → order-form limit-price input updates, **no page re-render** |
| **Drag leverage slider** | order-form | slider fill grows; live `×N` badge; margin-required preview recomputes | broadcasts leverage → account-bar + order-form margin preview update |
| **Toggle Buy/Sell** | order-form | active side button solid (`--trade-buy`/`--trade-sell`), inactive outlined; submit CTA recolors | writes `orderDraft.side`; account-bar liq-preview recolors |
| **Switch chart interval** | chart-panel | active interval chip filled; others ghost | writes `chartInterval`; chart island reloads candle series (ISR history + live) |
| **Change book grouping** | order-book | active grouping chip filled | writes `bookGrouping`; island re-buckets ladder client-side |
| **Symbol switch (⌘K palette)** | topbar | command palette opens (Dialog+Command island), fuzzy list | writes `activeSymbol` → chart+book+form+header resubscribe; **static shell chrome does not re-render** |
| **Order-book price flash on tick** | order-book | new/updated level flashes buy/sell tint for ~150ms then fades | island patch only |
| **Close position** | ledger | confirm affordance on row action | publishes reduce-only `orderDraft` to order-form |
| **Connection/mock-feed state** | funding-bar | badge: `LIVE (mock)` green / `RECONNECTING` amber (`tokens.color.signal`) | reflects mock `SubscriptionTransport` state |

Focus/ARIA: order book and tables are keyboard-navigable (rows `role="row"`, arrow-key move,
Enter = click-row action). Buy/Sell buttons are real `<button>`s; leverage slider is a shadcn
Slider island with `aria-valuenow`.

---

## 4. Panel → component mapping

Authoritative region→unit map. Unit types: **F** = SSR fragment (spine §5 table), **I** = client
island (hydrates via `@mvp/trade-client`), **S** = shared-UI primitive (packages/ui, shadcn),
**G** = global shell chrome. Detailed contracts live in [02-component-architecture.md](02-component-architecture.md).

| Grid area | Visible panel | Unit(s) | Type | Realtime | Island scope |
| --- | --- | --- | --- | --- | --- |
| `topbar` | app nav, brand, links | `AppNav` | S/G | no | — |
| `topbar` | symbol quick-switch / ⌘K | `CommandPalette` | S/I | no | full island (Dialog+Command) |
| `topbar` | wallet / connect | `WalletMenu` | S/I | no | dropdown island |
| `topbar` | theme / locale | `ThemeToggle`,`LocaleSwitcher` | S/I | no | small islands |
| `rail` | pair picker + watchlist | `marketrail` (uses `markets-table` data) | F | near-realtime | small (star toggle, filter) |
| `header` | mark/oracle/24h/funding/vol/countdown | `market-header` | F | near-realtime | small (countdown ticker) |
| `chart` | candles + interval control | `chart-panel` | F + I | near-realtime + ISR | yes (chart adapter + interval) |
| `book` | L2 ladder + depth + spread | `order-book` | F + I | **realtime** | patch-only |
| `trades` | prints tape | `trades-feed` | F + I | **realtime** | patch-only |
| `form` | market/limit, size, leverage, buy/sell | `order-form` | F + I | request-time + rt margin | yes (Slider, side toggle, submit) |
| `form` (foot) | equity/margin/withdrawable | `account-bar` | F + I | request-time + rt | small |
| `ledger` (tabs) | tab bar | `Tabs` | S/I | no | tab island |
| `ledger` (body) | positions | `positions-table` | F + I | **realtime** | patch-only |
| `ledger` (body) | open orders | `open-orders` | F + I | realtime/request-time | patch-only |
| `status` | funding schedule / countdown / conn badge | `funding-bar` | F | near-realtime | no |

Shared-UI primitives also used inside panels: `DataTable` (ledger + markets), `Tooltip` (book/PnL
hovers), `Toast` (order submit feedback), `Dialog` (mobile order sheet, command palette),
`Slider` (leverage).

---

## 5. Markets page layout (`/markets`, apps/page-markets)

Simple single-column page (spine §3, §9 single-page deploy example).

```
┌ topbar (global chrome) ──────────────────────────────────────────────────────┐
├──────────────────────────────────────────────────────────────────────────────┤
│  Markets                             [search ⌕]  [All ▾]  [Perps ▾]  [★ only] │  filter bar
├──────────────────────────────────────────────────────────────────────────────┤
│ ★  Symbol   Last       24h %     8h Funding   Volume(24h)   Open Int.   [Trade]│  header
│ ★  BTC      64,117.5   +1.24%    +0.0101%     1.2B          842M        [→]    │  rows → /trade/:sym
│    ETH       3,398.7   -0.58%    -0.0044%     640M          410M        [→]    │
│    SOL         142.10  +3.10%    +0.0210%     220M          130M        [→]    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Body is the `markets-table` fragment (near-realtime) rendered through the `DataTable` shared UI
  pattern; sortable column headers + client filter are a small island.
- Row click routes to `/trade/:symbol` (deep link, spine §3/§6). Star toggles watchlist via
  `@mvp/storage`.
- Responsive: below `md`, collapse to `Symbol · Last · 24h% · [Trade]`; other columns behind a
  row-expand disclosure.

---

## 6. Portfolio page layout (`/portfolio`, apps/page-portfolio)

```
┌ topbar (global chrome) ──────────────────────────────────────────────────────┐
├──────────────────────────────────────────────────────────────────────────────┤
│  portfolio-summary                                                            │
│  ┌ Equity ─────┐ ┌ Unrealized PnL ┐ ┌ Margin Usage ┐ ┌ Withdrawable ┐        │  stat cards
│  │ $12,480.20  │ │ +$157.05       │ │ 34%          │ │ $8,110.00    │        │
│  └─────────────┘ └────────────────┘ └──────────────┘ └──────────────┘        │
├───────────────────────────────────────────┬──────────────────────────────────┤
│  Positions (reuses positions-table view)  │  pnl-chart (ISR equity curve)     │
│  Symbol Side Size Entry Mark uPnL [Close]  │  ╱╲    ╱╲___                       │
│                                            │  ╱  ╲__╱                           │
├───────────────────────────────────────────┴──────────────────────────────────┤
│  Order history (open-orders / history view, paginated DataTable)              │
└──────────────────────────────────────────────────────────────────────────────┘
```

- `portfolio-summary` (request-time fragment) = the four stat cards.
- `pnl-chart` (ISR fragment) = equity curve; light island for hover-readout only.
- Positions + history reuse the `positions-table` / `open-orders` fragments in a read-oriented
  view (no order-form coupling here).
- Responsive: two-column split (`positions | pnl-chart`) collapses to stacked single column below
  `md`; stat cards go 4→2→1 across lg→md→sm.

---

## 7. Region z-index & overlay layering

Uses `tokens.zIndex` (base 0 / overlay 20 / modal 50).

| Layer | z | Contents |
| --- | --- | --- |
| base | 0 | grid panels, depth bars, tables |
| sticky | ~10 **[NEW TOKEN]** | mobile segmented control, mobile Buy/Sell bar, table header row |
| overlay | 20 | dropdowns (wallet/theme/locale), tooltips, order-book hover tooltip |
| modal | 50 | command palette, mobile order sheet, confirm dialogs, toasts |

---

## 8. Panel chrome conventions (shared visual grammar)

So all fragments look like one terminal despite independent deploys:

- Panel frame: `border: 1px solid var(--trade-panel-border)` **[NEW TOKEN]**, `border-radius:
  var(--mvp-radius-sm)`, header row `height 28px` uppercase 10px muted label + optional controls.
- Numeric emphasis: prices/sizes use `--trade-font-mono` with `font-variant-numeric: tabular-nums`.
- Directional color: `--trade-buy` / `--trade-sell` (derived from `tokens.color.accent` /
  `tokens.color.signal` families, **not** copied brand colors), plus `--trade-flash` tint for ticks.
- Empty/loading state: every fragment ships a **no-JS readable** SSR snapshot (matches existing
  no-js e2e posture in spine §13); islands only patch on top.

---

## 9. New tokens required

These are additions the layout needs; they belong in `@mvp/design-system` (spine §11) and must be
added to `@mvp/design-tokens` `tokens` before fragments consume them (edits go through the token
source, not hand-edited CSS). Flagged for the design-system agent.

| Token | Suggested value | Purpose |
| --- | --- | --- |
| `--trade-col-rail` | 240px | market rail width |
| `--trade-col-center` | 300px | book/trades column width |
| `--trade-col-form` | 320px | order-form column width |
| `--trade-row-topbar` | 56px | top chrome height |
| `--trade-row-status` | 32px | status strip height |
| `--trade-font-mono` | `ui-monospace, "SFMono-Regular", monospace` | dense numeric rows |
| `--trade-panel-border` | token-derived hairline | panel frame |
| `--trade-buy` / `--trade-sell` | accent/signal-derived pair | directional coloring |
| `--trade-row-hover` / `--trade-flash` | subtle tints | interaction states |
| `zIndex.sticky` (≈10) | 10 | sticky mobile bars / table headers |

---

## 10. Conflicts / spine-amendment requests

Surfaced for the spine owner (none block layout work; all are additive):

1. **New tokens (§9)** — spine §11 says `@mvp/design-system` is the one CSS source; the trade-specific
   tokens above should be recorded there. *Request: acknowledge the trade token namespace in §11.*
2. **`zIndex.sticky`** — spine `tokens.zIndex` has base/overlay/modal only; mobile sticky bars need an
   intermediate layer. *Request: add `sticky` to the token scale.*
3. **marketrail unit** — spine §5 lists `markets-table` but the trade page's left rail (pair picker +
   watchlist) is a distinct panel reusing markets data. Treated here as its own fragment
   `marketrail`. *Request: confirm `marketrail` as a listed trade-page fragment in §5, or confirm it
   should be a thin view over `markets-table`.* (02-component-architecture assumes a distinct fragment.)
4. **Ledger = tabbed multi-fragment panel** — spine §5 lists `positions-table` and `open-orders`
   separately; layout composes them under one shadcn Tabs shell with `order-history`/`funding` tabs.
   *Request: confirm `order-history` is a view of `open-orders` (assumed) rather than a new fragment.*

No behavioral conflicts with the spine; all realtime/island/SSR assignments here match spine §5–§8.
