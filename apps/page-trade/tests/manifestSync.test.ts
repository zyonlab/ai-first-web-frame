import { diffManifestAgainstRuntime } from "@mvp/registry";
import { describe, expect, it } from "vitest";
import { buildTradeSlotDefinitions } from "../src/fragmentSlots";
import tradeManifestSlots from "../src/manifest.slots.json";

// Refactor plan §3.4 drift check: keeps `manifest.slots.json` and the
// hand-wired runtime slots array in sync (see apps/page-home for the
// documented incident that motivated this check).
describe("page-trade manifest/runtime slot sync", () => {
  it("has no drift between manifest.slots.json and the runtime slots array", () => {
    const drift = diffManifestAgainstRuntime(
      tradeManifestSlots,
      buildTradeSlotDefinitions(),
    );
    expect(drift).toEqual([]);
  });
});
