import { describe, expect, it } from "vitest";
import { diffManifestAgainstRuntime } from "../../../platform/fragment-registry/src/slots";
import { buildPortfolioSlotDefinitions } from "../src/fragmentSlots";
import portfolioManifestSlots from "../src/manifest.slots.json";

// Refactor plan §3.4 drift check: keeps `manifest.slots.json` and the
// hand-wired runtime slots array in sync (see apps/page-home for the
// documented incident that motivated this check).
describe("page-portfolio manifest/runtime slot sync", () => {
  it("has no drift between manifest.slots.json and the runtime slots array", () => {
    const drift = diffManifestAgainstRuntime(
      portfolioManifestSlots,
      buildPortfolioSlotDefinitions(),
    );
    expect(drift).toEqual([]);
  });
});
