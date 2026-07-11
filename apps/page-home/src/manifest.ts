import { homePageBudget } from "./budget";
import homePageSlots from "./manifest.slots.json";

export const homePageManifest = {
  name: "page-home",
  route: "/",
  owner: "web-platform",
  version: "0.1.0",
  renderMode: "hybrid",
  renderStrategy: "hybrid",
  seo: {
    title: "MVP Storefront Home",
    description:
      "Discover curated offers and personalized recommendations in the MVP storefront.",
  },
  // Verified against src/manifest.slots.json + src/fragmentSlots.ts +
  // app/page.tsx (docs/DEMOS.md has the full breakdown):
  //  - composition:static+cached-ssr+dynamic-ssr — staticEditorial is
  //    "static", promotion is "cached-ssr", recommendations is "dynamic-ssr".
  //  - streaming:suspense-per-slot — streamHomeFragmentSlots + three
  //    <Suspense><FragmentSlotStream/> boundaries in app/page.tsx.
  //  - fallback-isolation — per-slot fallback markup + onRequiredFailure:
  //    "fallback" on the required "promotion" slot.
  //  - trace-panel — <section data-request-trace="home"> renders the
  //    per-request dependency-graph trace log.
  demonstrates: [
    "composition:static+cached-ssr+dynamic-ssr",
    "streaming:suspense-per-slot",
    "fallback-isolation",
    "trace-panel",
  ],
  slots: homePageSlots,
  budget: homePageBudget,
} as const;

export function validateHomePageManifest(manifest = homePageManifest): boolean {
  return Boolean(
    manifest.route &&
      manifest.renderMode &&
      manifest.seo &&
      manifest.budget &&
      manifest.slots.length > 0,
  );
}
