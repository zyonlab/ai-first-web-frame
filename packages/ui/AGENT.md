# @mvp/ui — AGENT.md

## What this package is for

`@mvp/ui` is the framework's server-safe React component library: plain
function components (`AppNav`, `Button`, `Card`, `Image`, `ProductCardBase`,
`Section`, `Skeleton`, plus a `./shadcn` subpath of pre-wired shadcn/Radix
primitives) with no client-only hooks, so every component renders identically
in an SSR fragment or a page. Each top-level component directory exports the
component, a `metadata.ts` (`ComponentMetadata` from `@mvp/contracts`,
generated via the local `factory.ts`), a `budget.ts`/inline budget
(`PerformanceBudget`, scope `"component"`), and `fixtures.ts` (example props
for tests/Storybook-like tooling). Import from the package's subpath exports
(`@mvp/ui/Button`, not deep paths) — each subpath is an independent entry in
`package.json#exports` so consumers only bundle what they use.

## Entry points

- `Button({ children, ...ButtonHTMLAttributes<HTMLButtonElement> }): ReactElement`
  (`import { Button, type ButtonProps } from "@mvp/ui/Button"`) — the base
  action button; forwards all native button attributes.
- `Card({ children, ...HTMLAttributes<HTMLElement> }): ReactElement`
  (`import { Card, type CardProps } from "@mvp/ui/Card"`) — a plain `<article>`
  surface wrapper used as the base of composite cards like
  `ProductCardBase`.
- `Section({ heading: string, children, ...HTMLAttributes<HTMLElement> }): ReactElement`
  (`import { Section, type SectionProps } from "@mvp/ui/Section"`) — a
  `<section>` with a required `<h2>{heading}</h2>`; use for page-level content
  blocks that need a landmark heading.
- `ProductCardBase({ title, price, imageSrc, imageAlt, description? }): ReactElement`
  (`import { ProductCardBase, type ProductCardBaseProps } from "@mvp/ui/ProductCardBase"`)
  — composite `Card` + `Image` product tile; `price` is a pre-formatted
  string, not a number.
- `AppNav({ currentPath, theme: "light"|"dark"|"system", locale: "en"|"zh", lastSymbol? }): ReactElement`
  (`import { AppNav, appNavCss, primaryNavLinks, type AppNavProps } from "@mvp/ui/AppNav"`)
  — the global top navigation, pure server-rendered `<a>`-based links (works
  with zero JS); pair with `appNavCss(prefix?)` to get its scoped stylesheet
  string for injection into `<head>`.
- `buttonMetadata: ComponentMetadata` / `buttonBudget: PerformanceBudget`
  (`import { buttonMetadata, buttonBudget } from "@mvp/ui/Button"`) — each
  component subpath exports its own `<name>Metadata`/`<name>Budget` pair built
  from the package's internal `metadata()`/`componentBudget()` factory (not
  itself public); use these to feed a manifest/registry entry or an audit that
  needs the component's declared budget without importing React.

## Import surface

`factory.ts` (`metadata()`, `componentBudget()`) is internal — it is not
exported from `@mvp/ui`'s root `index.ts` or listed in `package.json#exports`.
Consume the pre-built `<name>Metadata`/`<name>Budget` values per component
instead of calling the factory yourself.

## Error taxonomy

`@mvp/ui` components are plain, prop-driven React function components — they
render whatever they are given and do not validate or throw on bad props at
runtime (TypeScript is the only enforcement layer; there is no Zod parsing
inside render). There are no package-specific error classes. The only
indirect failure mode is a budget/similarity **audit failure**, not a runtime
exception:
- `pnpm audit:bundle` / `pnpm audit:css` fail `pnpm verify` (not this
  package's tests) if a component's built JS/CSS exceeds its `budget.ts`
  (`PerformanceBudget`, scope `"component"`, from `@mvp/contracts`).
- `pnpm audit:similarity` fails `pnpm verify` if a new component under
  `packages/ui/src/<Name>` is judged too similar to an existing one — the
  fix is to reuse the flagged component, not add a near-duplicate.

## Example

```tsx
import { AppNav, appNavCss } from "@mvp/ui/AppNav";
import { Section } from "@mvp/ui/Section";
import { ProductCardBase } from "@mvp/ui/ProductCardBase";
import { Button } from "@mvp/ui/Button";

export function ProductPage() {
  return (
    <>
      <style>{appNavCss()}</style>
      <AppNav currentPath="/portfolio" theme="system" locale="en" />
      <Section heading="Featured">
        <ProductCardBase
          title="Perp Contract"
          price="$42,000.00"
          imageSrc="/img/btc.png"
          imageAlt="BTC perpetual contract"
          description="BTC-USD perpetual, 20x max leverage"
        />
        <Button type="button">Trade now</Button>
      </Section>
    </>
  );
}
```

## Accept

```
pnpm --filter @mvp/ui test
```
Expected: Vitest exits 0. Covers `packages/ui/src/index.test.tsx`,
`AppNav/AppNav.test.tsx`, and `shadcn/shadcn.test.tsx` (render smoke tests
for each exported component using its `fixtures.ts` sample props).
