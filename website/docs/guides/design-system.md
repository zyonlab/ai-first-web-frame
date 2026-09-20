# Design system

The visual layer is a separate package with no business dependencies, so it can be owned by a
design team and consumed by product teams without either editing the other's code.

## Layers

```
@mvp/design-tokens    raw scales -> CSS custom properties
@mvp/design-system    semantic tokens, themes, Tailwind preset, base reset
@mvp/ui               7 components (Button, Card, Image, Section, Skeleton, AppNav,
                      ProductCardBase) + ./shadcn (11 primitives: command, data-table,
                      dialog, dropdown-menu, locale-switcher, select, slider, tabs,
                      theme-toggle, toast, tooltip)
fragments/*           consume @mvp/ui and the CSS variables; never redefine a token
```

The layering rule is enforced: `dependency-audit.json` carries `tags` and `depConstraints`
(modelled on `@nx/enforce-module-boundaries`), and a violation is
`layer-constraint-violation`. A fragment may import `@mvp/ui`; `@mvp/ui` may not import a
fragment, a page, or a domain package.

## The contract between design and product

Everything crossing the boundary is a **CSS custom property**, prefixed `--mvp-`:

```ts
import { tokens, cssVariableNames, TOKEN_PREFIX } from "@mvp/design-system";
// TOKEN_PREFIX === "mvp"   ->   --mvp-color-…, --mvp-radius-sm, …
```

`cssVariableNames` is a frozen list of every variable the system emits. That list is what makes
the boundary auditable: `audit:css` counts a selector or variable nobody references as unused
bytes, so a token the design team removes cannot quietly linger.

Product code adjusts appearance by **setting** variables, not by editing components:

```css
.trade-terminal { --trade-panel-bg: var(--mvp-color-surface-sunken); }
```

The fragments follow this convention already — `order-book`'s stylesheet reads
`var(--trade-panel-border, #23262f)`, i.e. a business-scoped variable with a literal fallback, so
the panel still renders if the theme layer is absent.

## Theming

```ts
import {
  createThemeVariables, createAllThemeVariables, createBaseVariables,
  emitDeclarations, DARK_MODE_SELECTOR, themeColors,
} from "@mvp/design-system";
```

Two themes (`ThemeName = "light" | "dark"`), switched by attribute:
`DARK_MODE_SELECTOR === '[data-theme="dark"]'`. The Tailwind preset is configured
`darkMode: ["selector", DARK_MODE_SELECTOR]`, so Tailwind's `dark:` variants and the raw CSS
variables agree on one switch.

Theme is also a **request-context dimension** (`ctx.theme`: `light` | `dark` | `system`), and the
gateway exposes `GET /_shell/theme` so the choice survives a full page load rather than living
only in client state.

## Tailwind

```ts
// a consumer's tailwind.config.ts
import { tailwindPreset } from "@mvp/design-system";
export default { presets: [tailwindPreset], content: ["./src/**/*.{ts,tsx}"] };
```

The preset maps Tailwind's theme keys onto `var(--mvp-…)` rather than duplicating values, so
there is one definition per token. `@mvp/ui` also publishes `./tailwind.config` and
`./shadcn/globals.css` for consumers that need them directly.

## Component metadata

Every `@mvp/ui` component ships `metadata.ts` (category, `serverSafe`, `propsSchema`,
description), `budget.ts` and `fixtures.ts` alongside the component. The fixtures are what the
similarity audit and the component dev harness (`pnpm dev:component`) consume, and
`serverSafe` is what the server/client boundary audit checks against.

## Handing the layer over

Practically, a design team can own `packages/design-tokens`, `packages/design-system` and
`packages/ui` and ship them independently, because:

- those three packages import no domain or product code (enforced);
- their public surface is tokens + components + a Tailwind preset;
- `audit:css` and `audit:similarity` gate the two failure modes that a shared UI layer actually
  suffers from — dead CSS, and a near-duplicate component added instead of reusing one.

What is *not* automated is a visual regression suite. There is no screenshot baseline in the
repository, so a token change that shifts layout is caught by `maxCLS` only if a Playwright run
happens to measure it — and the web-vitals checks are not part of `pnpm verify`
([F11](../known-limitations.md#f11)).
