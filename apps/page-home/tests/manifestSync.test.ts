import { describe, expect, it } from "vitest";
import { diffManifestAgainstRuntime } from "../../../platform/fragment-registry/src/slots";
import { buildHomeSlotDefinitions } from "../src/fragmentSlots";
import homeManifestSlots from "../src/manifest.slots.json";

// Refactor plan §3.4 drift check: `manifest.slots.json` neither drives nor
// validates the hand-wired runtime slots array, so the two can silently
// drift (known incident: page-home's `promotion.required` disagreed between
// the manifest and the runtime). This test keeps them in sync going forward.
describe("page-home manifest/runtime slot sync", () => {
  it("has no drift between manifest.slots.json and the runtime slots array", () => {
    const drift = diffManifestAgainstRuntime(
      homeManifestSlots,
      buildHomeSlotDefinitions(),
    );
    expect(drift).toEqual([]);
  });
});
