# @mvp/ui

Two layers live here:

- **Server-safe components** (`Button`, `Card`, `Image`, `ProductCardBase`,
  `Section`, `Skeleton`) — SSR-first, CSS-Module + token-variable styled,
  `serverSafe: true`. Exported from the root (`@mvp/ui`) and per-component
  subpaths. **Do not** import the shadcn layer from these.
- **Vendored shadcn/ui island primitives** (`@mvp/ui/shadcn`) — Radix / cmdk
  client islands restyled to `@mvp/design-system` tokens. Every module begins
  with `"use client"`; `serverSafe: false`, `category: "island"`.

See [`docs/trade-demo/04-shadcn-and-styling.md`](../../docs/trade-demo/04-shadcn-and-styling.md)
for the full rationale.

## shadcn island conventions (frozen)

### 1. `cn` — the only class-merge helper

```ts
import { cn } from "@mvp/ui/shadcn";
cn("bg-surface-1", condition && "text-ink", props.className);
```

`cn = twMerge(clsx(...))` (`packages/ui/src/shadcn/cn.ts`). `clsx` resolves
conditional / array / object inputs; `tailwind-merge` de-dupes conflicting
utilities so a caller's `className` override always wins. It is the single place
`clsx` + `tailwind-merge` are combined — primitives and their `cva` variants
compose token utility strings and hand the result to `cn`.

### 2. Token classes only — never a hard-coded color

Utilities resolve to `var(--mvp-*)` via the design-system Tailwind preset
(`tailwindPreset`, contract C1). Use the semantic token names, never a hex or a
Tailwind arbitrary color value (`bg-[#...]`):

| Purpose            | Token class                                   |
| ------------------ | --------------------------------------------- |
| Page / panel bg    | `bg-surface-0` / `bg-surface-1` / `bg-surface-2` |
| Foreground text    | `text-ink`                                     |
| Muted text         | `text-text-muted`                              |
| Hairline / border  | `border-border`                                |
| Brand accent       | `bg-accent` / `text-accent` / `ring-accent`    |
| Buy / sell / signal| `text-buy` / `text-sell` / `text-signal`       |
| Spacing / radius   | `p-md` `gap-sm` `rounded-lg` (token scale)     |
| Elevation          | `shadow-raised`                                |
| Layering           | `z-overlay` / `z-modal` / `z-sticky`           |

Theme flips are a pure `data-theme` attribute change — the same utility recolors
in light and dark because its value is a variable, not a literal.

### 3. `cva` variants

Multi-look primitives (e.g. `Toast`) declare looks with
`class-variance-authority`, each variant mapping to token classes only:

```ts
const toastVariants = cva("... base token classes ...", {
  variants: { variant: {
    default: "border-border bg-surface-2 text-ink",
    success: "border-buy bg-surface-2 text-buy",
    error:   "border-sell bg-surface-2 text-sell",
  } },
  defaultVariants: { variant: "default" },
});
// consume: cn(toastVariants({ variant }), className)
```

### 4. Interaction islands vs. token demos

| Primitive | Radix / cmdk base | Notes |
| --- | --- | --- |
| `Dialog` | `@radix-ui/react-dialog` | modals, confirmations |
| `Tabs` | `@radix-ui/react-tabs` | panel / order-form switch |
| `Tooltip` | `@radix-ui/react-tooltip` | explainers, hovers |
| `Slider` | `@radix-ui/react-slider` | leverage |
| `Toast` | `@radix-ui/react-toast` | order notifications (cva variants) |
| `Command` | `cmdk` + `Dialog` | symbol switcher / ⌘K palette |
| `DropdownMenu` | `@radix-ui/react-dropdown-menu` | wallet / overflow menu |
| `Select` | `@radix-ui/react-select` | grouping, interval, margin mode |
| `DataTable` | plain `<table>` (no tanstack) | low-frequency tabular chrome only |
| `ThemeToggle` | plain buttons | token demo, pure UI + `onThemeChange` |
| `LocaleSwitcher` | `Select` | token demo, pure UI + `onLocaleChange` |

`ThemeToggle` / `LocaleSwitcher` are pure presentational: they hold no state and
never touch `document`; a P3 store binding will supply `theme`/`locale` +
callbacks.

### 5. Tailwind / CSS

- `tailwind.config.ts` consumes `tailwindPreset` from `@mvp/design-system` and
  scopes `content` to `./src/**/*.{ts,tsx}`. Preflight is **off** — the reset
  lives once in `@mvp/design-system` (`baseResetCss`).
- `@mvp/ui/shadcn/globals.css` ships `@tailwind components; @tailwind utilities;`
  only (no `@tailwind base`). The `--mvp-*` variables are injected once by the
  shell / `@mvp/assets`; this file redeclares none of them.

## Build

`pnpm --filter @mvp/ui build` (tsdown). Radix / cmdk / React are externalized —
the shadcn entry bundles only ~5 KB gz of island glue; the shared React + Radix
chunk is charged to the page budget, not per-fragment (doc 04 §5).

## Test

`pnpm -w exec vitest run packages/ui/src` (happy-dom; no jest-dom setup, assert
with `toBeTruthy()`).
