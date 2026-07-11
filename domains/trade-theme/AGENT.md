# @mvp/trade-theme — AGENT.md

## What this package is for

`@mvp/trade-theme` owns the trade demo's semantic colors (`buy`/`sell`/`up`/
`down`) and the theme-scoped CSS that makes every `--trade-*` custom property
resolve per-`data-theme` (contract D6, the "两层割裂" fix: the SSR trade
fragments speak a `--trade-*` vocabulary with dark hardcoded fallbacks, and
before this bridge nothing ever *defined* those variables, so every panel
rendered dark regardless of theme while the page chrome followed it). It is a
**domain-layer** package (docs/ARCHITECTURE_REFACTOR_PLAN.md §2.1): it may
import framework packages — its only dependency is `@mvp/design-system` — but
`packages/**` must never import it back; imports only point downward,
enforced by the `auditPackageLayering` dependency-audit check. Provenance is
two moves: `createTradeAliasVariables` moved out of `packages/design-system`
in the P1 re-layering (§2.2), and the B3 closure (PR #19) then moved the
`buy`/`sell`/`up`/`down` color **values** themselves out of design-system's
token tables (byte-identical hex, only ownership moved — trade colors are
domain vocabulary, and goal B3 demands zero domain code under `packages/**`).
This package emits them via `emitDeclarations` — exported as a public
`@mvp/design-system` API precisely so a domain package can define its own
theme-aware tokens with the same mechanism `createThemeVariables` uses
internally — into `:where([data-theme="light"])` / `:where([data-theme="dark"])`
blocks, so `--trade-buy` etc. flip per theme exactly like `--mvp-color-*`. Not
npm-published; the trade pages inject its output once per layout.

## Entry points

- `TradeSemanticColors = { buy: string, sell: string, up: string, down: string }`
  — the per-theme color record (`up` mirrors `buy`, `down` mirrors `sell`).
- `TRADE_SEMANTIC_COLORS: Record<ThemeName, TradeSemanticColors>` —
  (`ThemeName` is `@mvp/design-system`'s `"light" | "dark"`). The values moved
  verbatim from `packages/design-system/src/tokens.ts`:
  light `{ buy: "#0f9d58", sell: "#d32f2f", up: "#0f9d58", down: "#d32f2f" }`,
  dark `{ buy: "#22c55e", sell: "#ef4444", up: "#22c55e", down: "#ef4444" }`.
- `createTradeColorVariables(theme: ThemeName): string` — emits ONE theme's
  semantic color block:
  `:where([data-theme="<theme>"]){--trade-buy: <hex>;--trade-sell: <hex>;--trade-up: <hex>;--trade-down: <hex>;}`
  via `emitDeclarations("trade", "", TRADE_SEMANTIC_COLORS[theme])`. These
  blocks are the ONLY place `--trade-buy`/`--trade-sell`/`--trade-up`/
  `--trade-down` are defined — the `:where(:root)` alias block must never
  redefine them (two sources of truth would let source order silently
  reintroduce the colors-don't-follow-`data-theme` bug).
- `createTradeAliasVariables(prefix: string = TOKEN_PREFIX): string` — the
  full trade-theme CSS a page injects once (see `apps/page-trade`'s
  `app/layout.tsx`): both theme-scoped color blocks (light + dark) followed by
  a `:where(:root)` block of genuinely-derived aliases — panel chrome and
  typography pointing at theme-aware `--mvp-color-*` / `--mvp-font-*` tokens
  (`--trade-panel-bg`, `--trade-panel-border`, `--trade-text`,
  `--trade-text-muted`, `--trade-chip-active`, `--trade-row-hover`,
  `--trade-font-mono`), flash colors derived from the trade-owned variables
  (`--trade-flash-buy`/`--trade-flash-sell` are `color-mix(...)` over
  `var(--trade-buy)`/`var(--trade-sell)`, NOT `--mvp-color-*`), plus the
  terminal chrome-typography switch `--<prefix>-font-body: var(--<prefix>-font-control)`
  (storefront serif → terminal sans without a second global `body{}` rule,
  keeping the css-budget `globalSelectors` count flat). `prefix` defaults to
  `@mvp/design-system`'s `TOKEN_PREFIX` (`"mvp"`).

## Error taxonomy

Nothing throws, and there is nothing to catch: both functions are pure,
synchronous string builders over the static `TRADE_SEMANTIC_COLORS` record —
no I/O, no DOM, no validation path. The only invalid input, a `theme` outside
`"light" | "dark"`, is unrepresentable in type-checked code (`ThemeName` is a
closed union); forcing one past the compiler (`as ThemeName`) would surface as
a `TypeError` inside `emitDeclarations` iterating `undefined`, which is a
caller bug, not an API error condition.

## Example

```ts
import {
  createTradeAliasVariables,
  createTradeColorVariables,
  TRADE_SEMANTIC_COLORS,
} from "@mvp/trade-theme";

// Per-theme semantic color block: the ONLY definition site of --trade-buy etc.
const light = createTradeColorVariables("light");
console.log(light.startsWith(':where([data-theme="light"]){')); // true
console.log(light.includes("--trade-buy: #0f9d58;")); // true

// Light and dark genuinely diverge (theme-aware, not a shared fallback).
console.log(TRADE_SEMANTIC_COLORS.dark.buy); // "#22c55e"
if (TRADE_SEMANTIC_COLORS.light.buy === TRADE_SEMANTIC_COLORS.dark.buy) {
  throw new Error("trade semantic colors must differ per theme");
}

// The one string a page layout injects: light block + dark block + aliases.
const css = createTradeAliasVariables();
console.log(css.includes(':where([data-theme="dark"]){')); // true
console.log(css.includes(":where(:root){")); // true
console.log(css.includes("--trade-panel-bg:var(--mvp-color-surface-1)")); // true
console.log(
  css.includes(
    "--trade-flash-buy:color-mix(in srgb, var(--trade-buy) 26%, transparent)",
  ),
); // true — flashes derive from the trade-owned variable, not --mvp-color-*
console.log(css.includes("--mvp-font-body:var(--mvp-font-control)")); // true

// Regression guard: the :root alias block never redefines --trade-buy.
const rootBlock = css.slice(css.lastIndexOf(":where(:root){"));
if (rootBlock.includes("--trade-buy:")) {
  throw new Error("--trade-buy must only be defined in theme-scoped blocks");
}
```

## Accept

```
pnpm --filter @mvp/trade-theme test
```
Expected: Vitest exits 0. `domains/trade-theme/src/index.test.ts` covers the
exact preserved hex values per theme block, light/dark divergence, the
bundled light+dark+`:root` output of `createTradeAliasVariables`, that
`--trade-buy`/`--trade-sell`/`--trade-up`/`--trade-down` are never redefined
in the `:root` block, every chrome/typography alias mapping to a theme-aware
`--mvp-*` token, the `color-mix` flash derivations, the body-font swap, and
that the `:root` block carries no hardcoded hex colors.
