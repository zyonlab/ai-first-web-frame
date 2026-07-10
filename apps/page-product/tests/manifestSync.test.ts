import { diffManifestAgainstRuntime } from "@mvp/registry";
import { describe, expect, it } from "vitest";
import { buildProductSlotDefinitions } from "../src/fragmentSlots";
import productManifestSlots from "../src/manifest.slots.json";

// Refactor plan §3.4 drift check: keeps `manifest.slots.json` and the
// hand-wired runtime slots array in sync. `price-panel` is declared
// `reserved: true` in the manifest because it is hand-rendered as a static
// aside in `app/product/[id]/page.tsx`, not fetched through the runtime
// scheduler — the drift check treats a reserved slot's absence from the
// runtime array as the expected, non-drifting state.
describe("page-product manifest/runtime slot sync", () => {
  it("has no drift between manifest.slots.json and the runtime slots array", () => {
    const drift = diffManifestAgainstRuntime(
      productManifestSlots,
      buildProductSlotDefinitions(),
    );
    expect(drift).toEqual([]);
  });
});
