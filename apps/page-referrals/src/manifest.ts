import { referralsPageBudget } from "./budget";
import referralsPageSlots from "./manifest.slots.json";
import { referralsSeoCopy } from "./metadata";

/**
 * Page manifest for the slotless referrals page.
 *
 * `manifest.slots.json` is an EMPTY array by design — this page composes no
 * fragments (pure static content, the page-level-SSG demo pattern:
 * `app/referrals/page.tsx` exports `dynamic = "force-static"`). The manifest
 * + empty slots file exist so the page is a first-class unit in the release
 * graph: `tools/release-tools/src/load-graph.ts` discovers pages by their
 * `manifest.slots.json`, and `scripts/deploy-affected.mts` derives the
 * runtime-gate URL from this manifest's `route`. Without them, changes under
 * `apps/page-referrals/` fell through to a GLOBAL rebuild and the CI docker
 * matrix never built this page's image at all.
 */
export const referralsPageManifest = {
  name: "page-referrals",
  route: "/referrals",
  owner: "growth",
  version: "0.1.0",
  renderMode: "ssg",
  seo: {
    title: referralsSeoCopy.title,
    description: referralsSeoCopy.description,
  },
  budget: referralsPageBudget,
  slots: referralsPageSlots,
} as const;
