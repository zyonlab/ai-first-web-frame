# @mvp/design-tokens — AGENT.md

## What this package is for

`@mvp/design-tokens` holds the framework's raw, framework-agnostic design
token values (color, spacing, radius, font, z-index, breakpoint, shadow) as a
single frozen `tokens` object, plus a helper to render them as CSS custom
properties. It has zero dependencies and zero React/DOM assumptions — it is
consumed both at build time (Tailwind config, `@mvp/ui` component CSS
modules) and at request time (`createCssVariables` is called to inject a
`<style>` block into SSR'd HTML). It intentionally does not do theming
(light/dark, per-tenant overrides) — that composition lives in
`packages/design-system` (mid-refactor, not documented here); this package is
only the literal value source.

## Entry points

- `tokens: { color, spacing, radius, font, zIndex, breakpoint, shadow }` — the
  `as const` token object. Current groups/keys:
  `color.{ink,paper,accent,signal,muted}`,
  `spacing.{xs,sm,md,lg,xl}`, `radius.{sm,md,lg}`,
  `font.{body,control}`, `zIndex.{base,overlay,modal}`,
  `breakpoint.{sm,md,lg}`, `shadow.{raised}`. Read directly (e.g.
  `tokens.color.accent`) when a value is needed in TS/JS rather than CSS,
  such as a Tailwind config or a chart color.
- `createCssVariables(prefix = "mvp"): string` — flattens every group/key in
  `tokens` into `--<prefix>-<group>-<key>: <value>;` declarations wrapped in
  `:where(:root){...}` (e.g. `--mvp-color-accent: #0f766e;`), and returns the
  whole block as one CSS string ready to inject via `<style>` or write to a
  `.css` file. `:where()` keeps specificity at 0 so any consumer selector can
  override a token.

## Error taxonomy

None. `tokens` is a static literal object and `createCssVariables` is a pure
string-formatting function with no validation, no I/O, and no throw paths —
any `string` `prefix` (including an empty one) produces a syntactically valid,
if oddly named, CSS custom-property block.

## Example

```ts
import { tokens, createCssVariables } from "@mvp/design-tokens";

// Direct value read, e.g. inside a Tailwind config or chart palette:
console.log(tokens.color.accent); // "#0f766e"
console.log(tokens.spacing.md); // "16px"

// SSR head injection:
const styleBlock = createCssVariables("mvp");
// ":where(:root){--mvp-color-ink: #15171a;--mvp-color-paper: #fbfaf7; ...}"
const html = `<head><style>${styleBlock}</style></head>`;
```

## Accept

```
pnpm --filter @mvp/design-tokens test
```
Expected: Vitest exits 0. `packages/design-tokens/src/index.test.ts` asserts
`tokens`'s shape and that `createCssVariables()` emits every token as a
`--<prefix>-<group>-<key>` declaration.
