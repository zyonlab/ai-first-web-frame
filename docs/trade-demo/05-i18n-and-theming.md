# 05 — i18n + Theming

Anchored to the [Trade Demo spine](README.md), §8 (i18n + theming), with dependencies on
§2 (framework mapping), §4 (shadcn/styling), §7 (cross-component store), and §11 (shared
deps). When any detail here conflicts with the spine, the spine wins until amended there.

This document specifies how the perps demo does **locales** (`en`, `zh`) and **themes**
(`light`, `dark`, `system`) so that:

- Both are declared as first-class assets through `@mvp/assets` (`type: "i18n"` and
  `type: "theme"`), preloaded per page/fragment, deduped and ordered by the asset plane.
- SSR first paint is **correct and flash-free** — the server already knows the locale and
  theme from the `RequestContext` (which is cookie-seeded), so there is no client-side
  swap after hydration.
- Persistence lives in `@mvp/storage` behind a **cookie** policy (SSR-readable), with
  `ThemeToggle` / `LocaleSwitcher` islands writing through it.

---

## 1. Contracts we build on (already in the repo)

| Source | Field / API | Role here |
| --- | --- | --- |
| `@mvp/contracts` `RequestContextSchema` | `locale: string`, `theme: "light" \| "dark" \| "system"` (default `system`) | Authoritative per-request locale + theme. Drives SSR `<html lang>` / `data-theme`. |
| `@mvp/assets` | `I18nAsset { locale, namespace, messages?, href? }` | Declares an i18n namespace bundle per page/fragment; emitted as `<script type="application/json" id="i18n-<locale>-<namespace>">`. |
| `@mvp/assets` | `ThemeAsset { name, content?, href?, media? }` | Declares a theme token set; emitted as inline `<style data-theme="...">` (content) or `<link data-theme="...">` (href). |
| `@mvp/assets` | `collectAssets`, `createAssetHtmlTags` | Merge + dedupe (`i18n` keyed by `locale\0namespace`, `theme` keyed by `name`) and render to tags. Default type order puts `theme` before `js` and `i18n` last. |
| `@mvp/design-tokens` | `tokens`, `createCssVariables(prefix="mvp")` | Base token object + `:where(:root){ --mvp-* }` emitter. `@mvp/design-system` (new, spine §11) layers the light/dark sets on top. |
| `@mvp/storage` | `createStorage`, `createCookieStorageAdapter`, `createCookiePolicyForStorage` | Cookie-backed, partitioned, optionally signed persistence for theme + locale. |

> Note the asset plane treats i18n messages as **inline JSON script tags** and theme
> `content` as **inline `<style>`**; both accept a `nonce` (see §5, CSP). The existing
> `apps/page-home/app/layout.tsx` already demonstrates the exact injection pattern we
> extend here.

---

## 2. Locales

### 2.1 Set

- Ship set: `en` (source of truth) and `zh`.
- BCP-47 tags used at the context / `<html lang>` boundary: `en-US`, `zh-CN`
  (matching the existing home layout). Namespace *files* are keyed by the short base
  (`en`, `zh`) to stay short; the loader maps `en-US -> en`.
- Extensible: adding `ja` = add a locale column of namespace JSON + register its
  `I18nAsset`s. No code change to the loader.

### 2.2 Namespaces (split per surface)

One namespace per surface keeps each page/fragment loading only the strings it renders,
which is what lets the asset plane preload the right subset per unit.

| Namespace | Owned by | Loaded on |
| --- | --- | --- |
| `common` | shell-gateway | every page (buttons, toasts, generic labels, units) |
| `nav` | shell-gateway | every page (top nav, menus, command palette, wallet) |
| `trade` | page-trade + trade fragments | `/trade/:symbol` |
| `markets` | page-markets | `/markets` |
| `portfolio` | page-portfolio | `/portfolio` |

`vaults` / `referrals` reuse `common` + `nav` only in this phase (lightweight pages,
spine §3).

### 2.3 Directory layout

```
packages/i18n/                      # new shared package (@mvp/i18n)
  src/
    index.ts                        # loader + t() + formatters (see §7)
    locales/
      en/
        common.json
        nav.json
        trade.json
        markets.json
        portfolio.json
      zh/
        common.json
        nav.json
        trade.json
        markets.json
        portfolio.json
    assets.ts                       # buildI18nAssets(locale, namespaces) -> I18nAsset[]
```

Each page/fragment imports `buildI18nAssets` and declares only the namespaces it needs;
the shell declares `common` + `nav` centrally so pages never re-declare them (dedupe by
`locale\0namespace` guarantees a single copy even if two units both ask for `common`).

### 2.4 Key naming convention

- Dot-namespaced, **surface-relative** (the namespace is implicit from the file), snake or
  camel segments — pick camel to match repo style:
  `orderForm.side.buy`, `book.header.price`, `funding.next.countdown`.
- No English text as keys (avoids drift when copy changes).
- Interpolation via `{placeholder}` tokens; pluralization deferred (not needed for the
  demo copy — noted as a future `Intl.PluralRules` hook in §7).
- Trading terms are centralized in `common.terms.*` so the same gloss is reused across
  nav, trade, portfolio (a "mark price" tooltip reads identically everywhere).

### 2.5 Trading terminology — bilingual samples

Small illustrative slice of `common.json > terms`; not exhaustive.

| Key (`terms.*`) | `en` | `zh` |
| --- | --- | --- |
| `mark` | Mark Price | 标记价格 |
| `oracle` | Oracle Price | 预言机价格 |
| `funding` | Funding Rate | 资金费率 |
| `funding.next` | Next Funding | 下次资金费用 |
| `liq` | Liq. Price | 强平价格 |
| `leverage` | Leverage | 杠杆 |
| `pnl` | PnL | 盈亏 |
| `pnl.unrealized` | uPnL | 未实现盈亏 |
| `margin` | Margin | 保证金 |
| `size` | Size | 仓位数量 |
| `long` | Long | 做多 |
| `short` | Short | 做空 |
| `reduceOnly` | Reduce Only | 只减仓 |

Abbreviations (`Liq.`, `uPnL`) are treated as first-class strings so `zh` can expand them
rather than being forced to reuse the English abbreviation.

---

## 3. i18n loading through `@mvp/assets`

### 3.1 Declaration → preload → SSR read

```
RequestContext.locale ──► resolveLocale() = "en" | "zh"
                            │
     page/fragment ─────────┤ buildI18nAssets(locale, ["common","nav","trade"])
                            ▼
   collectAssets(...)  ──► dedupe by (locale, namespace), order by asset.order
                            ▼
   createAssetHtmlTags ──► <script type="application/json"
                              id="i18n-<locale>-<namespace>"
                              data-locale data-namespace nonce="...">{...messages}</script>
```

Because messages are inlined into the SSR HTML as JSON script blocks, the **first paint
already contains the correct-language strings** in the DOM (SSR renders them via `t()`
server-side; the JSON tag is only there for islands to read the same dictionary without a
second fetch). There is no client fetch on the critical path and therefore no text swap.

### 3.2 Which locale renders SSR

Single source: `RequestContext.locale`, resolved as:

1. `mvp_locale` cookie (via `@mvp/storage`, see §6) if present and supported.
2. else negotiate `Accept-Language` against the ship set (`en`, `zh`).
3. else fall back to `en`.

The shell resolves this once per request, sets `<html lang="<bcp47>">`, and passes the
short locale down to each page/fragment so they all render the same language. No island
ever needs to re-resolve — it reads `document.documentElement.lang` + the inlined JSON.

### 3.3 Preload strategy

- Small namespaces (`common`, `nav`) are always inlined (no network hop).
- Larger namespaces may be declared with `href` instead of `messages` for a `<link
  rel="preload">`-style fetch; the same `I18nAsset` shape supports both. For the demo we
  keep everything inline — the copy volume is tiny and inlining is the strongest no-flash
  guarantee.
- `order` is used so `common` (order 1) precedes surface namespaces, keeping the JSON
  blocks in a predictable place in `<head>`/end-of-`<body>`.

---

## 4. Theming

### 4.1 Two token sets, one variable contract

`@mvp/design-system` (spine §11) extends `@mvp/design-tokens` with **light** and **dark**
value sets that emit the *same* CSS variable names (`--mvp-color-*`, `--mvp-spacing-*`,
`--mvp-radius-*`, …). Only the values differ between themes; consumers never branch on
theme in their own CSS — they read the variable.

```
@mvp/design-tokens.tokens (structure + shared scales: spacing, radius, font, z, shadow)
        │
        ├── light values  ─┐
        └── dark values   ─┤ createThemeCss(name) -> ":root[data-theme='light']{ --mvp-color-ink:...; ... }"
                            ▼
                 ThemeAsset { name: "light", content }  +  ThemeAsset { name: "dark", content }
```

- Selector strategy: values are scoped to `:root[data-theme='light']` and
  `:root[data-theme='dark']`. `data-theme="system"` resolves to one of the two via a
  `@media (prefers-color-scheme: dark)` block that only applies when
  `data-theme='system'` (see §5.2).
- This aligns with **04-shadcn-and-styling.md**: Tailwind's `theme.extend` maps color
  utilities onto these same `--mvp-*` variables, and vendored shadcn components use the
  variables directly. So a shadcn `<DropdownMenu>` island and an SSR order-book row read
  the identical variable and flip together when `data-theme` changes — no per-component
  theme wiring.

### 4.2 Injection through `@mvp/assets`

Both theme sets are declared as `ThemeAsset`s and emitted by `createAssetHtmlTags` as
inline `<style data-theme="light">` / `<style data-theme="dark">` (the `content` branch),
each carrying the CSP `nonce`. The shell declares them once (deduped by `name`); pages and
fragments never re-emit them. This matches the existing `layout.tsx` `themes: [...]`
pattern, generalized to two named sets plus the base variable block from
`createCssVariables()`.

Asset order: base variables (`css`/`theme` base) → `light` → `dark`. Since both light and
dark are always present but gated by the `data-theme` attribute, switching theme is a pure
attribute flip — **no stylesheet load, no repaint stall, no flash**.

---

## 5. No-FOUC / no-theme-flash SSR strategy

The rule: **the correct `data-theme` class is present in the very first byte of HTML**, so
there is never an unstyled or wrong-theme frame that a client script has to correct.

### 5.1 First-paint decision (server-side, from cookie)

```
Request ──► @mvp/storage cookie adapter reads `mvp_theme` (light|dark|system)
        ──► RequestContext.theme
        ──► shell renders <html data-theme="<theme>">
```

- If the cookie is `light` or `dark`: server writes that exact value → deterministic, no
  media query involved, guaranteed no flash.
- If the cookie is `system` (or absent): server writes `data-theme="system"`, and the CSS
  in §5.2 resolves it to the OS preference **via CSS only** (still no JS on the critical
  path). Worst case the OS preference and a stale guess disagree for one frame *only if we
  guessed*, which we don't — we emit `system` and let the media query decide, so the first
  painted frame already matches the OS.

### 5.2 The `system` resolution CSS (framework-owned, nonce'd)

```css
:root[data-theme='light'] { /* light --mvp-* values */ }
:root[data-theme='dark']  { /* dark  --mvp-* values */ }

@media (prefers-color-scheme: dark) {
  :root[data-theme='system'] { /* dark --mvp-* values */ }
}
@media (prefers-color-scheme: light) {
  :root[data-theme='system'] { /* light --mvp-* values */ }
}
```

Because all four bindings ship in the initial inline `<style>` blocks, the browser
resolves the correct set during the first style pass. No `<script>` runs before paint;
nothing observes-then-corrects.

### 5.3 Why no blocking inline script is needed

Many apps ship a synchronous "theme guessing" `<script>` in `<head>` to avoid FOUC.
We don't, because:

- `light`/`dark` are decided **on the server from the cookie** (SSR is authoritative).
- `system` is resolved **by CSS media queries**, not JS.

The `ThemeToggle` island only runs *after* hydration, and only when the user actively
switches — it is never on the first-paint critical path.

---

## 6. Persistence (`@mvp/storage`)

### 6.1 Why cookie

Theme and locale must be readable **on the server** to render the correct first paint, so
they live in a **cookie** policy (not `localStorage`, which the server can't read). We use
the existing `createCookieStorageAdapter` / `createCookiePolicyForStorage`.

| Cookie | Values | Policy notes |
| --- | --- | --- |
| `mvp_theme` | `light` \| `dark` \| `system` | `privacy: "public"`, partitioned by nothing (theme is not user-private); `SameSite=Lax`, `Secure`, **not** `HttpOnly` (islands must read/write it), `Max-Age` ~1yr. |
| `mvp_locale` | `en` \| `zh` | Same policy shape as `mvp_theme`. |

Both are `public` privacy, so they are unsigned and can be partitioned-free
(`canUseSharedStorage` returns true). They are deliberately **not `HttpOnly`** because the
`ThemeToggle` / `LocaleSwitcher` islands write them client-side; there is no security
value in server-only theme.

Other prefs mentioned in spine §2 (watchlist, layout, recent symbols) use their own
policies and are out of scope for this doc — only theme+locale are covered here.

### 6.2 Data flow of the toggle islands

`ThemeToggle` and `LocaleSwitcher` are the only client surfaces that mutate these. They
hydrate through `@mvp/trade-client` (spine §4/§11 — single React runtime) as small
islands.

```
ThemeToggle island (client)
  user picks light | dark | system
        │  1. write cookie  ──► document.cookie = mvp_theme=<v>; Path=/; Max-Age=...; SameSite=Lax; Secure
        │  2. apply now     ──► document.documentElement.setAttribute("data-theme", <v>)   // instant, no reload
        └─ (no server round-trip needed; CSS already present flips immediately)

LocaleSwitcher island (client)
  user picks en | zh
        │  1. write cookie  ──► mvp_locale=<v>
        └─ 2. navigate      ──► location.reload()   // locale changes SSR strings; a fresh SSR render is simplest + correct
```

- **Theme switch is instant and reload-free**: both token sets are already in the DOM, so
  flipping `data-theme` re-resolves every `--mvp-*` variable in place. shadcn islands and
  SSR panels re-theme together.
- **Locale switch reloads**: because SSR-rendered strings are baked into HTML, the clean
  correct way is a re-render. The cookie is written first, so the next SSR pass renders in
  the new language with, again, no flash. (A future enhancement could hot-swap strings
  from the inlined JSON without reload; the reload path is the shippable baseline.)

### 6.3 Store-slice seam (alignment with 02/03)

Theme and locale are **not** part of the cross-component *trade* store (03's slices are
`activeSymbol`, `orderDraft`, `chartInterval`, `hoveredPrice`, `bookGrouping`). They are
**global UI preferences** owned by the shell, persisted via cookies, and exposed to
islands as read-only ambient state (`document.documentElement.lang` / `data-theme` +
inlined dictionaries). Keeping them out of the trade store avoids coupling symbol/order
flows to chrome preferences.

- If a future island needs to *react* to a live theme/locale change without reload, add a
  dedicated `@mvp/interaction` channel (e.g. `shell.theme`, `shell.locale`) published by
  the toggle islands — parallel to, and separate from, the trade store. This is the clean
  extension point; it is **not** wired in this phase (theme flips via attribute, locale
  via reload).

---

## 7. Number / currency / time localization

All formatting goes through `Intl.*` with the resolved locale; no hand-rolled formatters.
Centralized in `@mvp/i18n` so every fragment formats identically.

| Kind | API | Notes for trading UI |
| --- | --- | --- |
| Prices / sizes | `Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits })` | Fraction digits come from the market's tick/lot metadata (page data), **not** the locale. Locale only controls grouping + decimal separator. |
| Percent (funding, 24h change, PnL %) | `Intl.NumberFormat(locale, { style: "percent", signDisplay: "exceptZero" })` | `signDisplay` gives `+`/`-` for change/PnL. |
| Currency (USD notional, equity) | `Intl.NumberFormat(locale, { style: "currency", currency: "USD" })` | Currency is fixed (USD) even under `zh`; only separators/placement localize. |
| Countdown (next funding) | derived duration formatted by `@mvp/i18n` helper (mm:ss); `Intl.RelativeTimeFormat` for "in Xh" copy | Deterministic from mock funding schedule. |
| Timestamps (trades tape, order history) | `Intl.DateTimeFormat(locale, { hour, minute, second })` | Uses the resolved locale's clock convention. |

Key point: **numeric precision is data-driven, locale is presentation-driven.** A BTC mark
price shows the same number of decimals in `en` and `zh`; only `1,234.5` vs the localized
grouping differs. This keeps trading correctness independent of language.

---

## 8. RTL — reserved, not implemented this phase

- No RTL locale ships now (`en`, `zh` are both LTR), so RTL is **not built**.
- Reserved hooks so it's a drop-in later:
  - `<html dir="...">` is set from an `i18n` locale metadata field (`ltr` default); the
    shell already owns `<html>`, so adding `dir` is a one-line change.
  - Layout CSS in the design system uses **logical properties** (`margin-inline-start`,
    `padding-inline`, `inset-inline`) rather than physical `left`/`right` where practical,
    so a future `dir="rtl"` mirrors automatically.
  - Directional glyphs (order-book depth bars, PnL arrows) are the known follow-ups to
    audit when an RTL locale is added.
- Explicitly out of scope: no RTL QA, no mirrored chart, no bidi handling this phase.

---

## 9. Acceptance checklist for this area

- [ ] `@mvp/i18n` ships `en` + `zh` for `common`, `nav`, `trade`, `markets`, `portfolio`.
- [ ] Every page/fragment declares only its needed namespaces via `buildI18nAssets`; shell
      owns `common` + `nav`; `collectAssets` dedupes to one copy each.
- [ ] `@mvp/design-system` emits light + dark token sets as `ThemeAsset`s over the same
      `--mvp-*` variable names; Tailwind/shadcn (04 doc) read the same variables.
- [ ] SSR sets `<html lang>` + `data-theme` from `RequestContext`; `system` resolves via
      CSS media queries only; **no theme/locale flash** on first paint (verify by
      throttled reload).
- [ ] `mvp_theme` + `mvp_locale` persisted as public, non-HttpOnly, `SameSite=Lax`
      cookies via `@mvp/storage`.
- [ ] `ThemeToggle` flips `data-theme` instantly (no reload); `LocaleSwitcher` writes
      cookie then reloads; both hydrate through `@mvp/trade-client`.
- [ ] All numeric/date formatting goes through `@mvp/i18n` `Intl.*` helpers; precision is
      data-driven, separators locale-driven.
- [ ] `dir`/logical-property hooks present; no RTL locale enabled.
