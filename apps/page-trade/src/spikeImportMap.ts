import { resolveFragment } from "@mvp/registry";

/**
 * C3 spike ("Runtime island assets", docs/ARCHITECTURE_REFACTOR_PLAN.md
 * §4.3.3) shared vendor import map.
 *
 * Maps every bare specifier `fragments/order-form/src/island.browser.ts`
 * actually imports (confirmed by inspecting its real build output, not
 * assumed) to the matching file this package's `build:spike-vendor` step
 * (`tsdown.vendor.config.ts`) builds once and Next.js serves as a static
 * asset straight out of `public/spike-vendor/`. `react`/`react-dom/client`
 * point at chunks that internally share ONE physical `react` module (see
 * `vendor-src/react.ts`'s doc comment) — required so the dynamically loaded
 * island's hooks run against the same React instance its own mounted root
 * uses, not a second copy.
 *
 * This map is intentionally scoped to exactly what order-form's browser
 * build needs today. A real rollout serving more than one island would grow
 * this list (and would need the shared chunk to widen with it — see the
 * `ui-shadcn.ts` vendor entry's own doc comment on why it's narrowed to just
 * `Slider` right now).
 */
export const SPIKE_VENDOR_IMPORT_MAP: Record<string, string> = {
  react: "/spike-vendor/react.js",
  "react/jsx-runtime": "/spike-vendor/react-jsx-runtime.js",
  "react-dom/client": "/spike-vendor/react-dom-client.js",
  "@mvp/trade-contracts": "/spike-vendor/trade-contracts.js",
  "@mvp/ui/shadcn": "/spike-vendor/ui-shadcn.js",
};

/**
 * Resolves order-form's real, registry-declared browser island asset URL
 * (its `assetsUrl`, canary channel — the same channel every trade slot
 * resolves through, see `fragmentSlots.gen.ts`). Returns `null` when the
 * registry entry has no `assetsUrl` yet (e.g. any fragment other than
 * order-form, or order-form before it was registered with one) — the C3
 * spike loader renders nothing in that case rather than hardcoding a URL.
 */
export function resolveOrderFormSpikeModuleUrl(): string | null {
  return resolveFragment("order-form", "canary")?.assetsUrl ?? null;
}
