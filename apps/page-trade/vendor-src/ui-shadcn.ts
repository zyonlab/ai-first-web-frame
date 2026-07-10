// See react.ts. `@mvp/ui/shadcn` (the vendored Radix Slider `OrderFormIsland`
// renders) is the one extra dependency the island actually needs beyond the
// four the spike's success criteria named. tsdown's default library-bundling
// behavior already leaves every bare-specifier `node_modules` import external
// (confirmed empirically — no `--external` flags were even required for
// `fragments/order-form`'s browser build), so this had to be resolved
// somehow for the island to render at all; sharing it here — one more vendor
// entry, no fragment-side config — was simpler than forcing tsdown to inline
// Radix into the fragment's own bundle.
//
// Named (not `export *`) so rolldown's tree-shaking drops the rest of
// `@mvp/ui/shadcn`'s surface (Dialog/DropdownMenu/Select/Tabs/Toast/Tooltip/
// command palette/data-table) — order-form only uses `Slider`. A real
// rollout sharing this chunk across multiple islands would need to widen
// this back out (or split shadcn per-component) as more islands' real usage
// is known.
export { Slider } from "@mvp/ui/shadcn";
