import { vaultsPageBudget } from "./budget";
import vaultsPageSlots from "./manifest.slots.json";
import { vaultsSeoCopy } from "./metadata";

/**
 * Page manifest for the slotless vaults page.
 *
 * `manifest.slots.json` is an EMPTY array by design — this page composes no
 * fragments (pure server-rendered content, the page-level-ISR demo pattern).
 * The manifest + empty slots file exist so the page is a first-class unit in
 * the release graph: `tools/release-tools/src/load-graph.ts` discovers pages
 * by their `manifest.slots.json`, and `scripts/deploy-affected.mts` derives
 * the runtime-gate URL from this manifest's `route`. Without them, changes
 * under `apps/page-vaults/` fell through to a GLOBAL rebuild and the CI
 * docker matrix never built this page's image at all.
 *
 * `revalidateSeconds` mirrors `app/vaults/page.tsx`'s `revalidate = 3600` —
 * the declared intent. Known limitation (refactor plan §4.4 item 3): the
 * shared layout's `headers()` call currently keeps the route dynamic in
 * practice.
 */
export const vaultsPageManifest = {
  name: "page-vaults",
  route: "/vaults",
  owner: "growth",
  version: "0.1.0",
  renderMode: "isr",
  revalidateSeconds: 3600,
  seo: {
    title: vaultsSeoCopy.title,
    description: vaultsSeoCopy.description,
  },
  budget: vaultsPageBudget,
  slots: vaultsPageSlots,
} as const;
