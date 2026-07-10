"use client";

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { OrderFormIsland, type OrderFormIslandComponentProps } from "./island";

export type {
  OrderFormIslandComponentProps,
  OrderFormIslandDeps,
} from "./island";
/**
 * Browser entry point for the C3 spike ("Runtime island assets",
 * docs/ARCHITECTURE_REFACTOR_PLAN.md §4.3.3).
 *
 * This file (NOT `island.tsx`) is the tsdown entry built for the browser
 * (`pnpm --filter @mvp/fragment-order-form run build:island-browser`,
 * chained into the package's `build` script). `react`, `react/jsx-runtime`,
 * and `@mvp/trade-contracts` are marked `--external` in that build, so this
 * bundle imports them as bare specifiers at runtime — resolved by the
 * `<script type="importmap">` `apps/page-trade` emits, pointing at a shared
 * vendor chunk `apps/page-trade` builds and serves once. `react-dom/client`
 * is external too so the mounted React root shares the exact same React
 * module instance as the rest of the import-map graph (a second bundled copy
 * of `react-dom` would violate React's single-instance invariant).
 *
 * `@mvp/ui/shadcn` (the `Slider` used inside `OrderFormIsland`) is
 * deliberately left un-externalized here — it bundles directly into this
 * file. Only `react`/`@mvp/store`/`@mvp/islands`/`@mvp/trade-contracts` were
 * required to be externalized by the spike's success criteria; `@mvp/store`
 * and `@mvp/islands` turned out to need no action at all (see the module
 * doc comment on `island.tsx`: `@mvp/store` is a type-only import, erased at
 * build time, and `@mvp/islands` is never imported by the island component
 * itself — only by the page's hydration bootstrap). Sharing `@mvp/ui/shadcn`
 * too is a real, valuable follow-up for a full rollout (today it would
 * duplicate Radix per island); out of scope for a one-fragment spike.
 */
export { OrderFormIsland } from "./island";

/**
 * Mounts the order-form island into `el` using a fresh `react-dom/client`
 * root. Returns an `unmount` teardown. This is the function the page's
 * dynamic `import()` calls after resolving this module through the import
 * map — the moral equivalent of what `@mvp/islands`' `mountIsland` does for
 * the build-time-bundled islands, reimplemented minimally here so this
 * bundle has zero dependency on `@mvp/islands` (which the real imports of
 * `island.tsx` never pulled in to begin with).
 */
export function mountOrderFormIsland(
  el: Element,
  props: OrderFormIslandComponentProps,
): () => void {
  const root = createRoot(el);
  root.render(createElement(OrderFormIsland, props));
  return () => {
    root.unmount();
  };
}
