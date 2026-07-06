# 04 — shadcn/ui + Styling Integration

Anchored to the [Trade Demo spine](README.md), §4 (shadcn decision), §5 (component
decomposition), §8 (theming). This document turns the spine's hybrid decision into an
executable plan: how Tailwind reads our tokens, which UI is a Radix client island vs.
SSR-token CSS, how shadcn source is vendored, the budget math, and how it stays inside
the `server-client-boundary` and `dependency-audit` gates.

> Interface note: component boundaries (which fragment owns which island) are owned by
> [02-component-architecture.md](02-component-architecture.md); the shared packages
> (`@mvp/design-system`, `@mvp/trade-client`) are specified in
> [09-shared-dependencies.md](09-shared-dependencies.md). This doc references those
> contracts but does not redefine them.

---

## 1. Governing constraints (why this is not "just add shadcn")

1. The framework has **no Tailwind today**. UI is CSS Modules + design-token CSS variables
   (`packages/design-tokens/src/index.ts` → `createCssVariables()` emits
   `:where(:root){--mvp-color-ink: …; …}`). Existing components (`packages/ui/src/Button`)
   consume those variables directly: `border: 1px solid var(--mvp-color-ink, #15171a)`.
2. Components are **server-safe by default** (`serverSafe: true` in
   `packages/ui/src/factory.ts::metadata`). SSR-first; islands patch, they don't own first
   paint of data panels.
3. **Hard per-unit budgets** (from `@mvp/contracts` `defaultBudgets`):

   | Scope | jsBytes | cssBytes |
   | --- | --- | --- |
   | component | 15 000 | 5 000 |
   | fragment | 30 000 | 10 000 |
   | page | 180 000 | 50 000 |
   | shell | 80 000 | 20 000 |

   `bundle-budget-check` and `css-budget-check` fail `pnpm verify` if a unit exceeds these.
4. **Audit gates**: `dependency-audit` forbids client-only packages imported by server files
   (fastify fragments / shell / packages), and `server-client-boundary-check` fails on
   `server-imports-client-module` — with a **scoped exception** only for local `"use client"`
   islands imported inside `apps/page-*` (Next RSC boundary). Radix/Tailwind-runtime must
   live where those exceptions apply.

The plan below satisfies all four simultaneously.

---

## 2. Token bridge — Tailwind theme derives from `@mvp/design-tokens`

**Rule: one color/spacing source.** Tailwind never defines its own palette. Its
`theme.extend` maps to the **same CSS variables** `createCssVariables()` emits, so a token
change in `packages/design-tokens/src/index.ts` propagates to CSS Modules *and* Tailwind
utilities with no second edit.

### 2.1 How variables are named

`createCssVariables("mvp")` walks `tokens` and emits `--mvp-<group>-<key>`:

```
--mvp-color-ink: #15171a;      --mvp-color-paper: #fbfaf7;
--mvp-color-accent: #0f766e;   --mvp-color-signal: #d97706;
--mvp-color-muted: #69707a;
--mvp-spacing-xs: 4px … --mvp-spacing-xl: 40px;
--mvp-radius-sm|md|lg;  --mvp-font-body|control;  --mvp-shadow-raised; …
```

The trade demo extends this token set (bull/bear/warning + surface layers) in
`@mvp/design-system`, which re-exports `tokens` and a `createCssVariables()` superset. See
[09](09-shared-dependencies.md) §2. The **added trade tokens** (draft — flagged as
proposal for the design-system owner):

```
--mvp-color-bull: #16a34a;   --mvp-color-bear: #dc2626;
--mvp-color-surface-0/-1/-2; --mvp-color-border; --mvp-color-text-muted;
```

### 2.2 Tailwind preset draft

Tailwind config lives in `@mvp/design-system` as a **preset** (`tailwind-preset.ts`) so
every island package extends one file rather than copy-pasting. Draft:

```ts
// packages/design-system/src/tailwind-preset.ts   (build-time only; never imported by SSR)
import type { Config } from "tailwindcss";

// Each utility resolves to a token CSS variable — NOT a hard-coded hex.
const preset: Partial<Config> = {
  darkMode: ["class", '[data-theme="dark"]'], // see §2.3
  theme: {
    extend: {
      colors: {
        ink:    "var(--mvp-color-ink)",
        paper:  "var(--mvp-color-paper)",
        accent: "var(--mvp-color-accent)",
        signal: "var(--mvp-color-signal)",
        muted:  "var(--mvp-color-muted)",
        bull:   "var(--mvp-color-bull)",
        bear:   "var(--mvp-color-bear)",
        surface: {
          0: "var(--mvp-color-surface-0)",
          1: "var(--mvp-color-surface-1)",
          2: "var(--mvp-color-surface-2)",
        },
        border: "var(--mvp-color-border)",
      },
      spacing: {
        xs: "var(--mvp-spacing-xs)", sm: "var(--mvp-spacing-sm)",
        md: "var(--mvp-spacing-md)", lg: "var(--mvp-spacing-lg)",
        xl: "var(--mvp-spacing-xl)",
      },
      borderRadius: {
        sm: "var(--mvp-radius-sm)", md: "var(--mvp-radius-md)",
        lg: "var(--mvp-radius-lg)",
      },
      fontFamily: {
        body:    "var(--mvp-font-body)",
        control: "var(--mvp-font-control)",
      },
      boxShadow: { raised: "var(--mvp-shadow-raised)" },
      zIndex: { overlay: "20", modal: "50" },
      screens: { sm: "640px", md: "768px", lg: "1024px" }, // from tokens.breakpoint
    },
  },
};
export default preset;
```

> To stay literally single-sourced, the color/spacing objects above can be **generated** from
> the imported `tokens` object at build time (a tiny `tokensToTailwind(tokens)` helper) so a
> new token key does not need a matching preset edit. Draft helper lives in `@mvp/design-system`.

Island packages then just:

```ts
// packages/trade-client/tailwind.config.ts  (or per-island page)
import preset from "@mvp/design-system/tailwind-preset";
export default {
  presets: [preset],
  content: ["./src/**/*.{ts,tsx}"], // purge source — see §5.2
};
```

Because every Tailwind utility emits `var(--mvp-*)`, the utilities carry **no literal color**
— the value is resolved at runtime from whichever token block (`:root` light / `[data-theme]`
dark) is in scope. This is what makes islands theme automatically with the SSR chrome.

### 2.3 Light/dark mapping

Two token sets are injected as CSS variables by `@mvp/assets` (`ThemeAsset` with `content`,
`data-theme` attribute — see `createAssetHtmlTags` case `"theme"`). Concretely:

```css
:where(:root), [data-theme="light"] { --mvp-color-surface-0: #fbfaf7; --mvp-color-bull: #16a34a; … }
[data-theme="dark"]                 { --mvp-color-surface-0: #0e1013; --mvp-color-bull: #22c55e; … }
```

Tailwind's `darkMode: ["class", '[data-theme="dark"]']` means `dark:` variants activate under
`[data-theme="dark"]`. **We use `data-theme`, not a `.dark` class**, because:

- `@mvp/assets`'s theme tags already emit `data-theme="<name>"` (see the `"theme"` branch of
  `createAssetHtmlTags`), so the attribute is the framework's native theme signal.
- It carries the theme name (`light`/`dark`/future themes), not just a binary toggle.
- The shell sets `data-theme` on `<html>` from the cookie for a **no-flash SSR first paint**
  (detail in [05-i18n-and-theming.md](05-i18n-and-theming.md)); islands inherit it.

Utilities and CSS Modules read the **same variables**, so an SSR order-book row and a Radix
dropdown recolor from one attribute flip with zero JS.

---

## 3. What is a shadcn/Radix client island (and what is not)

### 3.1 Islands — shadcn + Radix (interactive chrome only)

These are genuinely interactive, low-frequency, and benefit from Radix's a11y/focus
management. All ship through the single `@mvp/trade-client` React runtime (spine §4.4) so
React/Radix are bundled **once**.

| shadcn component | Radix primitive | Where it lands in the demo |
| --- | --- | --- |
| `dropdown-menu` | `@radix-ui/react-dropdown-menu` | Wallet/connect menu, "more" overflow menu in `AppNav` (shell). |
| `command` | `cmdk` + dialog | Symbol quick-switcher / command palette (spine §3, §7 symbol switch flow). |
| `dialog` | `@radix-ui/react-dialog` | Connect-wallet modal, confirm-close-position, settings. |
| `tabs` | `@radix-ui/react-tabs` | Positions / Open-orders / Trade-history panel switch; order-form Market/Limit. |
| `select` | `@radix-ui/react-select` | Order-book grouping, chart interval, margin mode. |
| `tooltip` | `@radix-ui/react-tooltip` | Funding/oracle explainers, liq-price hover, budget-overlay hints. |
| `slider` | `@radix-ui/react-slider` | Leverage slider in `order-form` (spine §7 broadcasts to margin preview). |
| `toggle` | `@radix-ui/react-toggle` | Reduce-only, TP/SL enable, theme toggle. |
| `toast` | `@radix-ui/react-toast` | Order submit / fill / error notifications. |

Landing points by owner (cross-ref [02](02-component-architecture.md)):

- **Shell island(s)**: `AppNav` (dropdown-menu, command, dialog, toast host), `ThemeToggle`
  (toggle), `LocaleSwitcher` (select/dropdown), `WalletMenu` (dropdown, dialog).
- **`order-form` island**: tabs, slider, select, toggle, tooltip.
- **`chart-panel` island**: select (interval), tabs; chart itself is the adapter (§ below).
- Panel-level **tabs** wrapping positions/open-orders is a small trade-page island.

### 3.2 SSR + token CSS — NOT React/Radix

High-frequency data panels stay **server-rendered fragments emitting token-based CSS**, not
Radix trees. Realtime updates **patch** the SSR DOM via the island runtime
(`subscribeData` → targeted text/class writes), they do not re-render a React tree.

| Panel | Why SSR-token, not Radix |
| --- | --- |
| `order-book` rows / depth bars | Realtime L2 patches many rows/second; a Radix/React reconcile per tick blows the fragment 30 KB JS budget and adds GC pressure. Rows are `<div>`s styled by token CSS; patch writes `textContent` + a `--depth` custom property width. |
| `trades-feed` (tape) | Same: append-only high-frequency list; DOM node recycling beats React. |
| `positions-table` | Realtime mark/uPnL cells patch in place; only the *close* control is an island button. Table shell is SSR. |
| `open-orders` | Mostly SSR rows; cancel is a delegated island click, not a Radix component. |
| `market-header`, `funding-bar`, `account-bar` | Near-realtime numeric cells; token CSS + text patch. `funding-bar` has **no island** at all (spine §5). |

**Budget rationale.** The framework's whole thesis is SSR-first with tiny per-unit JS. If the
order book were a Radix/React island it would (a) re-bundle React unless routed through
`@mvp/trade-client`, and (b) even routed, still carry per-fragment island glue + reconcile
cost. Keeping them SSR means the fragment ships **~0 KB of framework JS** and only a few
hundred bytes of patch glue registered centrally — see §4.

---

## 4. Vendoring shadcn (copy-in source, not a runtime dep)

shadcn/ui is distributed as **source you copy in**, not an installed package. We keep it that
way; nothing named `shadcn` appears in any `package.json`.

### 4.1 Where vendored code lives

```
packages/ui/src/shadcn/          # vendored, restyled shadcn primitives (client)
  dropdown-menu.tsx  command.tsx  dialog.tsx  tabs.tsx  select.tsx
  tooltip.tsx  slider.tsx  toggle.tsx  toast.tsx
  _cn.ts                         # local class-merge helper (see 4.3)
packages/ui/src/shadcn/index.ts  # barrel, "use client" primitives
```

Each vendored file:

1. Starts with `"use client"` — it is an island primitive, never SSR-imported.
2. Is **restyled to our tokens**: replace shadcn's default `bg-background text-foreground`
   Tailwind classes with our token-backed utilities (`bg-surface-1 text-ink border-border`),
   whose values are `var(--mvp-*)`. No CSS-variable names from the shadcn starter survive; we
   do not ship shadcn's `globals.css` variable block — our `@mvp/design-system` reset owns it.
3. Keeps the Radix import (`@radix-ui/react-*`). **Radix is the only runtime dep**, declared
   once (§4.2).

### 4.2 Radix is bundled once, in the island runtime

Per spine §4.4, `@mvp/trade-client` is the single place React ships to the browser. Radix
primitives are a **dependency of `@mvp/trade-client`** (and/or the page-app island bundle),
so every island that mounts through it shares one Radix copy. Fragments do **not** list Radix
in their `package.json` — they declare the shared island chunk as an **asset dependency**
(`@mvp/assets` `js` asset), covered in [09](09-shared-dependencies.md) §3. This is what keeps
`dependency-audit`'s `duplicated-package-version` and re-bundling from triggering.

### 4.3 No new runtime-dependency conflict

- `_cn.ts` is a 6-line local `clsx`+`tailwind-merge` shim **or** we vendor those too; either
  way they are build-time/island-only and appear in exactly one `package.json`
  (`@mvp/trade-client`), so `duplicated-package-version` cannot fire.
- Vendored components import from `@mvp/design-system` for tokens (types only) and Radix for
  behavior. They never import page code or `@mvp/data` (they receive data via props/store).

---

## 5. Budget impact

### 5.1 Island JS/CSS increment (estimates)

All numbers **gzipped estimates**, to be replaced by real `stats.json` from `bundle-budget-check`.

| Piece | Est. JS (gz) | Notes |
| --- | --- | --- |
| React + ReactDOM (island runtime) | ~40 KB | Bundled **once** in `@mvp/trade-client`, shared by all islands. Not charged per fragment. |
| Radix core set (dropdown, dialog, tabs, select, tooltip, slider, toggle, toast) | ~28–34 KB | Once, in the shared island chunk. Tree-shaken to used primitives only. |
| `cmdk` (command palette) | ~6 KB | Once. |
| Chart adapter (lightweight-charts or canvas) | ~35–45 KB | Once, in `@mvp/trade-client`; loaded only on the trade page. |
| Per-island glue (`order-form`, `AppNav`, panel-tabs) | ~2–5 KB each | Charged to that island's owning unit. |
| SSR panel patch glue (order-book/trades/positions) | ~0.3–1 KB each | Registered centrally; fragment JS stays near zero. |

**Shared-chunk total (React + Radix + cmdk + chart): ~90–125 KB gz.** This is charged to the
**page** budget (180 KB jsBytes) as a shared dependency, **not** re-counted per fragment — see
budget attribution in [09](09-shared-dependencies.md) §4. Trade page headroom after the shared
chunk: ~55–90 KB for page glue + per-island glue, which comfortably fits the handful of small
islands above.

CSS increment: Tailwind's **purged** output for the island utilities used is small because
utilities reference variables (no per-color duplication). Estimate **~4–8 KB gz** of Tailwind
utility CSS for the whole island surface, plus the one-time reset+tokens from `@mvp/design-system`
(~2–3 KB) injected once. Fragments emit only their **scoped** CSS-module increment and stay
well under 10 KB each.

### 5.2 Keeping Tailwind minimal (tree-shake / purge)

- **`content` globbing** scoped to island source only (`./src/**/*.{ts,tsx}` per island / the
  page app). Fragments' SSR CSS-module files are **not** run through Tailwind, so no utility
  bloat leaks into fragment CSS budgets.
- No `@tailwind base` shipped from Tailwind — our **reset lives once in `@mvp/design-system`**
  (avoids Preflight duplication across units and keeps `css-budget-check`'s `globalSelectors`
  and `duplicatedRules` counts low). We ship only `@tailwind components; @tailwind utilities`
  in the island bundle, purged.
- Prefer **static class strings**; avoid dynamic `bg-${x}` concatenation that defeats purge.
- Lightning CSS minification is already what `css-budget-check` measures (it minifies before
  counting bytes), so authored whitespace is free.

### 5.3 Budget risk & mitigation

| Risk | Impact | Mitigation |
| --- | --- | --- |
| React+Radix counted per fragment | Every island fragment busts 30 KB JS | Single `@mvp/trade-client` chunk; fragments declare it as an `@mvp/assets` js dependency, not a bundle. |
| Tailwind Preflight duplicated across units | `globalSelectors`/`duplicatedRules` spike; CSS budget fail | Reset injected **once** by `@mvp/design-system`; disable Tailwind base. |
| Chart lib heavy | Trade page 180 KB JS at risk | Chart adapter lazy-loaded on trade route only; excluded from markets/portfolio pages. |
| Un-purged Tailwind | CSS balloons | Strict `content` globs; static class names; CI runs `css-budget-check`. |
| Order book as Radix island | Fragment JS + reconcile cost | SSR-token panel + central patch glue (§3.2). |
| Toast/dialog portals leak global CSS | `globalSelectors` count | Scope portal styles via token utilities on the portal root, no bare-element selectors. |
| Dark-mode duplicates every utility | 2× CSS | `dark:` used sparingly; most theming is variable-driven so utilities are single-emit. |

---

## 6. Audit compliance (no code changes required, but flagged)

### 6.1 `server-client-boundary-check`

- Vendored shadcn primitives are `"use client"`. The check only **fails** on
  `server-imports-client-module` when a **fastify fragment / shell / package** imports a client
  module. Our islands are imported **inside `apps/page-*`** (Next RSC), which the check
  explicitly allows for **local** (`./…`) island imports (see the `isLocalIsland` guard).
- **Implication for wiring**: islands must be imported by the page apps via **relative paths**,
  or the shared island entry must be consumed as an **asset dependency** (script tag) by
  fragments — not a JS `import`. Fragments therefore never `import` Radix/shadcn; they emit an
  SSR shell + an island **mount marker** and declare the `@mvp/trade-client` js asset. This is
  already how the framework's asset plane works; no audit-config change needed for fragments.
- `packages/ui/src/shadcn/*` sit under `packages/ui`, which the boundary check scans. They are
  `"use client"`, so they are treated as client components (size-warn only if >200 lines /
  >10 KB) — **not** flagged as server files. Keep each primitive under those limits (they are).

### 6.2 `dependency-audit`

- `client-only-dependency-in-server`: fires when a **non-`"use client"`** server file imports a
  package in `clientOnlyPackages` (default `framer-motion`, `@react-three/fiber`, `gsap`). Radix
  is **not** in that list, and our Radix imports live in `"use client"` files, so this does not
  fire today. **Recommendation (flagged, do not edit here):** to make the intent explicit and
  guard against a future accidental SSR import of Radix, add a `dependency-audit.json` at repo
  root listing `@radix-ui`, `cmdk`, `tailwindcss`, and the chart lib under `clientOnlyPackages`.
  That turns "Radix in a fastify fragment" into a hard fail. The scoped `isLocalIsland` allowance
  still lets `apps/page-*` import local islands.
- `duplicated-package-version`: satisfied by declaring Radix/React/chart **once** (in
  `@mvp/trade-client`; page apps get them transitively). Never add them to a fragment's
  `package.json`.
- `raw-fetch-in-business-code`: unaffected — islands get data via props / `@mvp/interaction`
  store / `@mvp/data`, never bare `fetch`.
- Tailwind itself is a **devDependency** (build-time), so it never appears in a server import
  and is not a runtime dep at all.

> **Config action item for the audit owner (not changed in this doc):** add root
> `dependency-audit.json` with `clientOnlyPackages` extended to `["framer-motion",
> "@react-three/fiber", "gsap", "@radix-ui/react-*", "cmdk", "<chart-lib>"]` and confirm the
> `apps/page-*` local-island allowance covers the trade/markets/portfolio pages.

---

## 7. Summary decision table

| Concern | Decision |
| --- | --- |
| Color/spacing source of truth | `@mvp/design-tokens` CSS variables; Tailwind `theme.extend` maps to `var(--mvp-*)`. |
| Dark mode strategy | `data-theme="dark"` attribute (matches `@mvp/assets` theme tags), not `.dark` class. |
| Interactive chrome | shadcn + Radix **client islands** via `@mvp/trade-client`. |
| High-frequency data panels | SSR fragments + token CSS; realtime **patched**, not React-rerendered. |
| shadcn distribution | **Vendored** source in `packages/ui/src/shadcn`, restyled to tokens; no runtime `shadcn` dep. |
| Radix distribution | One copy in `@mvp/trade-client`; fragments declare it as an `@mvp/assets` js asset. |
| Tailwind footprint | Purged, base/reset disabled (reset lives once in `@mvp/design-system`), island-scoped `content`. |
| Budget attribution | Shared island chunk charged to **page**, not per-fragment. |
| Audits | Radix in `"use client"` only; add `dependency-audit.json` to make Radix/Tailwind explicitly client-only. |

## 8. Open decisions to ratify in the spine

1. **Ratify introducing Tailwind at all** (spine §4 says "introduce Tailwind as a build-time
   tool scoped to client-island UI"). This doc assumes yes. Final go/no-go belongs in the spine.
   *Alternative if no:* author island CSS as plain CSS Modules over the same tokens — loses
   shadcn's copy-in convenience but removes the Tailwind toolchain entirely.
2. **Chart library choice** (lightweight-charts vs. a canvas adapter) drives ~35–45 KB of the
   shared chunk; needs a spine line so [02](02-component-architecture.md)/[09] can size the
   trade-page budget precisely.
3. **`dependency-audit.json` addition** (§6.2) — needs sign-off from the audit owner; noted
   here, not applied.
