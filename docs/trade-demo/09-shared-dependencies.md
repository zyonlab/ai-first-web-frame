# 09 — Shared CSS/JS Dependency Strategy

Anchored to the [Trade Demo spine](README.md), §11 (shared dependency strategy), §2 (the two
new packages `@mvp/design-system` + `@mvp/trade-client`), §4 (styling), §8 (theming). This
document specifies the two shared packages, how the asset plane (`@mvp/assets`) makes every
fragment **declare** the shared JS/CSS instead of re-bundling it, how order/dedupe/SRI are
enforced, and how budgets are attributed by owner.

> Interface notes:
> - Styling/Tailwind/shadcn details are owned by [04-shadcn-and-styling.md](04-shadcn-and-styling.md).
> - Fragment/island boundaries and mount markers are owned by
>   [02-component-architecture.md](02-component-architecture.md).
> - The interaction store slices are owned by [03-data-architecture.md](03-data-architecture.md);
>   this doc consumes them via `@mvp/trade-client`, it does not define them.

---

## 1. Problem statement

Nine trade fragments + shell + 4 pages each need: the same tokens + reset CSS, and (for
islands) the same React + Radix + interaction-store client + chart adapter. If each unit
bundled these independently:

- **JS**: React (~40 KB) + Radix (~30 KB) re-bundled per island fragment → every island
  fragment instantly busts the **30 KB fragment `jsBytes`** budget, and the page pays for N
  copies. `dependency-audit` would also flag `duplicated-package-version`.
- **CSS**: the reset + token variable block re-emitted per unit → `css-budget-check`'s
  `globalSelectors` and `duplicatedRules` spike; the page pays N× for identical rules.

The fix is **two shared packages plus asset-plane deduplication**: define the shared code once,
reference it everywhere as an `@mvp/assets` asset, and let `mergeAssetsWithPolicy` guarantee it
is emitted exactly once in a deterministic order.

---

## 2. `@mvp/design-system` — the single CSS source

**Responsibility**: the one place tokens, the Tailwind preset, and the base reset are defined.
Consumed by shell, all pages, all fragments (for tokens/types), and every island (for the
Tailwind preset).

### 2.1 Contents & exports

```
packages/design-system/
  src/
    tokens.ts            # re-exports + extends @mvp/design-tokens tokens (adds bull/bear/surface/border)
    css-variables.ts     # createCssVariables() superset: light block + [data-theme="dark"] block
    reset.css            # base reset (box-sizing, margin/padding zero, font defaults) — emitted ONCE
    tailwind-preset.ts   # build-time only; maps utilities → var(--mvp-*) (see 04 §2.2)
    assets.ts            # designSystemAssets(): AssetManifest fragment for shell to mount
    index.ts             # barrel
```

Exports:

| Export | Kind | Consumed by |
| --- | --- | --- |
| `tokens` | value (server-safe) | anyone needing token values in TS |
| `createCssVariables()` | fn → CSS string (light + dark) | shell, injected as a `ThemeAsset` |
| `resetCss` (string) or `reset.css` href | CSS | shell, injected **once** as a `CssAsset` |
| `tailwindPreset` | build-time config | island `tailwind.config.ts` (04 §2.2) — never SSR-imported |
| `designSystemAssets()` | `AssetManifest` | shell composition (mounts reset + theme tokens) |

`tailwind-preset.ts` is **build-time only** and must never be imported by a fastify fragment or
`packages/*` server file (it pulls the Tailwind types); it is imported solely by island
`tailwind.config.ts` files. This keeps `dependency-audit` clean.

### 2.2 The single CSS injection

The shell (owner of global chrome per spine §2) mounts the design-system CSS **once** for the
whole document:

```ts
// apps/shell-gateway — composition
import { designSystemAssets } from "@mvp/design-system";
import { createCssVariables, resetCss } from "@mvp/design-system";

const shellAssets: AssetManifest = {
  css: [
    { id: "ds-reset", href: "/assets/design-system/reset.css", order: 0, integrity: "sha384-…" },
  ],
  themes: [
    { name: "tokens", content: createCssVariables(), order: 0 }, // light + [data-theme=dark] blocks
  ],
};
```

Fragments do **not** re-emit reset or tokens. They emit only their **scoped CSS-module
increment** (see §5). Because tokens are injected on `<html>` by the shell, a fragment's
`var(--mvp-*)` references already resolve at SSR time.

---

## 3. `@mvp/trade-client` — the single JS chunk

**Responsibility**: the only React that reaches the browser (spine §4.4). One shared chunk
containing the island bootstrap, the interaction-store client, and the chart adapter, plus the
vendored Radix/shadcn primitives. Every island mounts through it so React/Radix are bundled
once.

### 3.1 Contents & exports

```
packages/trade-client/
  src/
    bootstrap.ts     # scans DOM for island mount markers, hydrates matching islands
    registry.ts      # island-name -> lazy component map (order-form, app-nav, panel-tabs, chart)
    store-client.ts  # @mvp/interaction client: activeSymbol, orderDraft, chartInterval, hoveredPrice, bookGrouping
    patch.ts         # SSR-panel patch helpers (order-book/trades/positions) — text/attr writes, no React
    chart-adapter.ts # wraps the chart lib; lazy-loaded on trade route only
    index.ts
```

Runtime deps (declared **here, once**): `react`, `react-dom`, `@radix-ui/react-*`, `cmdk`,
`<chart-lib>`, class-merge shim. No fragment or other package lists these.

Exports (browser entry): a built, hashed IIFE/ESM chunk served at
`/_client/trade-client.<contenthash>.js`, and a **small SSR-safe** module (`markers.ts`)
exporting the mount-marker helper fragments render (a `data-island` attribute + serialized
props), which is server-safe and carries **no React**.

### 3.2 Fragments declare the chunk as an asset, they don't import it

Per spine §11, a fragment that has an island (`order-form`, `chart-panel`, panel-tabs) does two
things:

1. SSR-renders its shell + an **island mount marker** (`markers.ts`, server-safe).
2. In its `/assets` manifest, **declares the shared JS chunk as a dependency** — a `JsAsset`
   pointing at the shared `@mvp/trade-client` URL, deferred, body-placed:

```ts
// fragments/order-form — /assets response fragment
const orderFormAssets: AssetManifest = {
  js: [
    {
      id: "trade-client",                                // stable id → dedupe key (see §4.1)
      src: "/_client/trade-client.9f3ac2.js",
      defer: true,
      module: true,
      placement: "body",
      integrity: "sha384-…",                             // SRI (see §6)
      crossOrigin: "anonymous",
      order: 100,                                         // after tokens/reset
    },
  ],
};
```

Every island fragment declares **the same `id: "trade-client"` / same `src`**. When the page
composes all fragment asset manifests, `@mvp/assets` collapses these to **one** `<script>`.

### 3.3 Why not a plain import

If a fragment did `import { bootstrap } from "@mvp/trade-client"`, the fastify fragment bundle
would pull React/Radix — busting its 30 KB JS budget and tripping
`server-client-boundary-check` / `dependency-audit` (client-only dep in a server file). The
asset-declaration path keeps the fragment server-only and moves the JS into the one shared,
page-charged chunk. This is the whole point of spine §11.

---

## 4. Asset-plane wiring: order, dedupe, SRI

`@mvp/assets` is the mechanism (`collectAssets` → `mergeAssetsWithPolicy` →
`createAssetHtmlTags`).

### 4.1 Dedupe

`createAssetKey` keys a `JsAsset` by `id` when present, else by `src`; a `CssAsset` by
`id`/`href`+media+layer; a `ThemeAsset` by `name`. So:

- All island fragments emit `{ type:"js", id:"trade-client", src:"…trade-client.9f3ac2.js" }` →
  same key → **one** script. (Even without `id`, identical `src` dedupes.)
- Shell emits `{ type:"css", id:"ds-reset" }` and `{ type:"theme", name:"tokens" }` → one each,
  regardless of how many fragments assume they exist.

`collectAssets(...)` calls `mergeAssetsWithPolicy` with default `duplicate: "keep-first"`, and
`preserveSecurityFields` carries `integrity`/`nonce`/`crossOrigin` forward if the first
occurrence omitted them — so SRI survives dedupe.

### 4.2 Order

`compareEntries` sorts by explicit `order` first, then `defaultTypeOrder`
(`css:0, theme:1, font:2, js:3, i18n:4`), then key, then insertion index. Practical result for
the trade page:

1. `ds-reset` CSS (`order: 0`)
2. token variables `ThemeAsset` (`order: 0`, type `theme` after css)
3. fonts (preload)
4. shared `trade-client` JS (`order: 100`, deferred, body) — after styles so first paint is
   styled before hydration
5. i18n JSON blocks

The explicit `order` numbers make this robust even as fragments are added; type order is the
tiebreak. `placement:"body"` + `defer` keeps the shared JS non-blocking.

### 4.3 Composed AssetManifest (draft, page-trade)

```ts
import { collectAssets, createAssetHtmlTags } from "@mvp/assets";
import { designSystemAssets } from "@mvp/design-system";

const assets = collectAssets(
  designSystemAssets(),          // reset css (id ds-reset) + tokens theme  — from shell/design-system
  marketHeaderAssets(),          // scoped css only (no js)
  orderBookAssets(),             // scoped css only (SSR-patched, no island js)
  orderFormAssets(),             // scoped css + trade-client js (id trade-client)
  chartPanelAssets(),            // scoped css + trade-client js (same id → deduped) + chart is inside chunk
  panelTabsAssets(),             // trade-client js (same id → deduped)
  // …trades-feed, positions-table, open-orders, account-bar, funding-bar: scoped css only
);
const tags = createAssetHtmlTags(assets); // one ds-reset link, one tokens style, ONE trade-client script
```

`trade-client` appears in three fragment manifests but renders as **one** `<script>` with SRI.

---

## 5. CSS sharing & dedupe

- **Global once**: reset + token variables injected by the shell/design-system (§2.2). Keyed by
  `id`/`name` so they cannot duplicate no matter how many fragments assume them.
- **Scoped increments**: each fragment ships only its own `*.module.css` delta (locally-scoped
  class names, `var(--mvp-*)` for all values — matching the existing `Button.module.css`
  pattern). No fragment ships a `:root{…}` block or bare-element (`html`,`body`) selectors, so
  `css-budget-check`'s `globalSelectors` stays at the single shell-owned block and
  `duplicatedRules` stays ~0 across units.
- **Tailwind utilities** (islands only) are purged and reference variables, so `dark:` variants
  don't double the palette (04 §5.2). Tailwind Preflight is **disabled** because the reset lives
  once in `@mvp/design-system`.
- `mergeAssetsWithPolicy` guarantees CSS ordering: reset (`order:0`) → tokens theme → per-fragment
  scoped CSS (default `order`), so cascade is deterministic and fragment CSS always wins over
  reset without `!important` (keeps `importantCount` low).

---

## 6. Versioning, caching, SRI

- **Content hashing**: shared chunk served as `trade-client.<contenthash>.js`; reset as
  `reset.<hash>.css`. Long-lived immutable cache headers; a new build → new hash → new URL.
- **SRI**: each shared asset carries `integrity: "sha384-…"` + `crossOrigin: "anonymous"`.
  `createAssetHtmlTags` emits these via `pickSecurityAttributes`; `preserveSecurityFields`
  ensures the integrity survives dedupe even if a later duplicate omitted it. The build computes
  the hash and stamps it into the manifest emitted by `@mvp/design-system` / `@mvp/trade-client`.
- **Version coupling**: fragments reference the shared chunk **by URL (hash), not npm version**,
  so a fragment does not need a redeploy when the shared chunk is rebuilt *unless* its marker
  contract changes. The URL is injected via the env-override convention (spine §9 /
  `NEXT_SYMBOL_URL`-style), e.g. `TRADE_CLIENT_URL`, so channels (canary/stable) can point at
  different builds without editing fragment source.
- `nonce` is supported by the asset plane for CSP; the shell supplies the per-request nonce and
  the CSP allows the shared chunk's host/hash.

---

## 7. Budget attribution (by owner)

`bundle-budget-check` and `css-budget-check` measure per **scope** (`component`/`fragment`/
`page`/`shell`). Attribution rules for shared assets:

| Asset | Charged to | Rationale |
| --- | --- | --- |
| `@mvp/design-system` reset + tokens CSS (~2–3 KB) | **shell** (`cssBytes` 20 KB) | Shell owns global chrome + injects once. |
| Fragment scoped CSS module | that **fragment** (`cssBytes` 10 KB each) | Only the delta belongs to the fragment. |
| Shared `trade-client` JS chunk (React+Radix+cmdk+chart, ~90–125 KB gz) | **page** (`jsBytes` 180 KB) | It's a page-level shared dependency loaded once per page; **not** re-counted per fragment. Charging it to the page is what keeps every island fragment under its 30 KB. |
| Per-island glue (order-form/app-nav/panel-tabs, ~2–5 KB) | owning **fragment/shell** | Genuinely unique to that unit. |
| SSR-panel patch glue (order-book/trades/positions, <1 KB) | registered centrally → **page** | Lives in the shared chunk's registry, not per fragment. |

> **Convention (flagged for the budget-tooling owner):** the shared chunk must be counted in the
> **page** `stats.json` scope and **excluded** from each fragment's `stats.json`, otherwise it
> would be triple-counted and falsely fail fragment budgets. `bundle-budget-check` reads scopes
> independently, so the stats emitter simply attributes the shared bytes to `page`. This is a
> stats-attribution rule, not a tool change.

Estimated trade-page JS budget ledger (gz estimates, to be replaced by real stats):

| Line item | Bytes (gz) |
| --- | --- |
| Shared `trade-client` chunk | ~90–125 KB |
| Page + per-island glue | ~15–30 KB |
| **Total vs. page budget 180 KB** | **~105–155 KB → PASS** |

---

## 8. Dependency graph (who depends on whom)

Text form:

```
@mvp/design-tokens
      └─ @mvp/design-system  (extends tokens; owns reset + Tailwind preset + createCssVariables)
             ├─ shell-gateway        (injects reset+tokens ONCE via @mvp/assets)
             ├─ pages (trade/markets/portfolio)   (Tailwind preset for island CSS; token types)
             ├─ fragments/*          (token VALUES/types only; scoped CSS refs var(--mvp-*))
             └─ @mvp/trade-client    (token types for vendored shadcn primitives)

@mvp/interaction ──┐
<chart-lib> ───────┤
react/react-dom ───┼─ @mvp/trade-client  (single browser JS chunk: bootstrap+store client+chart+Radix/shadcn)
@radix-ui/* ───────┘        │
                            ├─ shell island (AppNav/Wallet/Theme/Locale/Command)
                            ├─ order-form island, chart-panel island, panel-tabs island
                            └─ referenced by fragments as an @mvp/assets JsAsset (id "trade-client"), NOT imported

@mvp/assets  (governs order/dedupe/SRI/budget attribution across ALL of the above)
```

Table form:

| Consumer | Depends on `@mvp/design-system` | Depends on `@mvp/trade-client` | How |
| --- | --- | --- | --- |
| shell-gateway | yes (inject reset+tokens) | yes (chrome islands) | asset manifest + island mount |
| page-trade / page-markets / page-portfolio | yes (Tailwind preset, token types) | yes (islands) | build-time preset + asset manifest |
| island fragments (order-form, chart-panel, panel-tabs) | yes (token types, preset for own island CSS) | **as asset dep** (id `trade-client`) | `@mvp/assets` JsAsset, not JS import |
| SSR-only fragments (order-book, trades-feed, positions-table, open-orders, market-header, account-bar, funding-bar) | yes (token values, scoped CSS) | patch glue only (in shared chunk) | scoped CSS asset; SSR marker |
| `@mvp/trade-client` | yes (token types) | — | imports design-system types + Radix/React/chart |

**Never**: a fragment importing `@mvp/trade-client` as JS; a fragment emitting `:root`/reset
CSS; Radix/React/chart in any fragment `package.json`.

---

## 9. Open decisions to ratify in the spine

1. **Chart library** choice sizes the shared chunk (~35–45 KB of the estimate) — needs a spine
   line (shared with [04](04-shadcn-and-styling.md) §8).
2. **Shared-chunk budget attribution to `page`** (§7) — confirm with the budget-tooling owner
   that the stats emitter attributes shared bytes to `page` scope and excludes them from
   fragment scopes.
3. **`@mvp/design-system` and `@mvp/trade-client` workspace placement**: spine §2 places them in
   `packages/`. `@mvp/trade-client` carries client-only runtime deps; confirm it is only ever
   consumed as a built asset URL by fragments (not a workspace `import`), and add it to the
   `dependency-audit.json` `clientOnlyPackages` guard (see [04](04-shadcn-and-styling.md) §6.2).
