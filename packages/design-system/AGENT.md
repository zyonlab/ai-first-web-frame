# @mvp/design-system — AGENT.md

## What this package is for

`@mvp/design-system` is the single source of truth for CSS custom-property
token names/values, theme CSS blocks, a global base reset, and a Tailwind
preset that maps utilities onto the same `--mvp-*` variables — layered on top
of the lower-level `@mvp/design-tokens` scale primitives. Every variable name
in `cssVariableNames` is a frozen contract: consumers (SSR fragments,
Tailwind islands, shadcn-style primitives) must only reference names in that
list, and both `light`/`dark` theme blocks emit identical variable *names*
with different *values* so a theme switch is a pure `data-theme` attribute
flip with zero JS. As of the current P1 re-layering pass, only
`createTradeAliasVariables` was moved out (now in `domains/trade-theme`); the
semantic color set itself (`SemanticColors` in `src/tokens.ts`) still bakes in
trading-specific keys (`buy`, `sell`, `up`, `down`) alongside generic ones
(`surface-0/1/2`, `ink`, `text-muted`, `border`, `accent`, `signal`, `muted`)
and the base scales include a trade-specific `grid` group (`book`/`rail`/
`form` track widths) — document what actually exists today, not an
idealized generic-only token set.

## Entry points

- `tokens: { color: SemanticColors, spacing, radius, font, breakpoint, shadow, zIndex, grid }`
  — the full token surface with concrete (light-theme) values resolved;
  `tokens.color.buy` etc. resolve directly, use `themeColors`/
  `createThemeVariables` for the per-theme override.
- `cssVariableNames: readonly string[]` — the frozen, deterministically-built
  (colors first, then scale groups) list of every `--mvp-*` variable name this
  package emits, e.g. `--mvp-color-buy`, `--mvp-spacing-md`, `--mvp-grid-book`.
  The only names any consumer may reference.
- `themeColors: Record<ThemeName, SemanticColors>` / `lightColors` /
  `darkColors: SemanticColors` — per-theme semantic color value maps
  (`ThemeName = "light" | "dark"`).
- `baseScales: { spacing, radius, font, breakpoint, shadow, zIndex, grid }` —
  theme-invariant token scales (identical values in both themes).
- `TOKEN_PREFIX: "mvp"` — the variable-name prefix used everywhere
  (`--${TOKEN_PREFIX}-${group}-${key}`).
- `createBaseVariables(prefix?: string = TOKEN_PREFIX): string` — emits the
  theme-invariant scale variables once as
  `:where(:root){--mvp-spacing-md:...;...}`.
- `createThemeVariables(theme: ThemeName, prefix?: string = TOKEN_PREFIX): string`
  — emits one theme's semantic color variables scoped to
  `:where([data-theme="<theme>"])`.
- `createAllThemeVariables(prefix?: string = TOKEN_PREFIX): string` — the
  shell's one-shot injection point: base scales + a bare `:where(:root)` light
  color block (so light paints even with no `data-theme` attribute present) +
  the explicit `light` and `dark` `[data-theme]` blocks, concatenated.
- `baseResetCss: string` — a single global-selector CSS reset/base-style
  block (box-sizing, margin reset, focus-visible ring using
  `var(--mvp-color-accent)`, reduced-motion media query, etc.), meant to be
  injected exactly once by the shell; the framework intentionally does not
  ship Tailwind Preflight.
- `tailwindPreset: TailwindPreset` — a pure JS Tailwind config object (no
  `tailwindcss` import) with `theme.extend.{colors,spacing,fontFamily,
  borderRadius,boxShadow,zIndex,screens}` generated from the token groups, so
  every Tailwind utility resolves to `var(--mvp-*)` rather than a literal
  value; `darkMode` is `["selector", DARK_MODE_SELECTOR]`.
- `DARK_MODE_SELECTOR: '[data-theme="dark"]'` — the selector Tailwind's
  `darkMode` config uses, matching the `data-theme` attribute
  `@mvp/design-system`'s theme blocks (and `@mvp/assets`'s theme tags) key
  off, not a `.dark` class.

## Error taxonomy

This package defines no custom error classes and throws nothing itself —
every export is a pure function over static token data or a plain data/string
constant. There is no validation surface (token shapes are TypeScript-checked
at compile time, not runtime-parsed).

## Example

```ts
import {
  createAllThemeVariables,
  baseResetCss,
  tailwindPreset,
  cssVariableNames,
  tokens,
} from "@mvp/design-system";

// Shell: inject once, ahead of any page content.
const themeCss = createAllThemeVariables(); // base scales + light + dark blocks
const globalCss = `${baseResetCss}${themeCss}`;

// Confirm a variable a fragment wants to use is part of the frozen contract:
console.log(cssVariableNames.includes("--mvp-color-buy")); // true

// A concrete light-theme value, useful outside CSS (e.g. inline SVG fill):
console.log(tokens.color.buy); // "#0f9d58"

// Build-time only, in an island package's tailwind.config.ts:
export default {
  presets: [tailwindPreset],
  content: ["./src/**/*.{ts,tsx}"],
};
```

## Accept

```
pnpm --filter @mvp/design-system test
```
Expected: Vitest exits 0. `packages/design-system/src/index.test.ts` covers
`cssVariableNames` staying in sync with `baseScales`/`themeColors`, the
`:where()` wrapping of `createBaseVariables`/`createThemeVariables`, and that
every `tailwindPreset` utility value is a `var(--mvp-*)` reference.
