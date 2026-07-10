import { describe, expect, it } from "vitest";
import {
  checkFragmentSlotsGenFileFreshness,
  generateFragmentSlotsSource,
  InvalidManifestSlotsError,
} from "./codegen";

// Extracts the `fragmentSlots` array literal from generated source and
// parses it back to plain data. Every field the generator emits is JSON-safe
// (string/number/boolean/array/record), so the array literal itself is valid
// JSON once wrapped — this lets tests assert on structure without depending
// on exact whitespace/formatting (the formatter, not this module, owns that).
function extractSlots(source: string): unknown[] {
  const match = source.match(
    /export const fragmentSlots: FragmentSlotDefinition\[\] = (\[[\s\S]*\]);/,
  );
  if (!match) throw new Error("generated source has no fragmentSlots array");
  return JSON.parse(match[1]);
}

describe("generateFragmentSlotsSource", () => {
  it("throws when manifest slots is not an array", () => {
    expect(() =>
      generateFragmentSlotsSource("page-home", { not: "an array" }),
    ).toThrow(InvalidManifestSlotsError);
  });

  it("throws with an actionable message on an invalid slot", () => {
    expect(() =>
      generateFragmentSlotsSource("page-home", [{ name: "" }]),
    ).toThrow(/manifest slots\[0\] for page "page-home" is invalid/);
  });

  it("emits an empty array literal for a page with no slots", () => {
    const source = generateFragmentSlotsSource("page-empty", []);
    expect(source).toContain(
      "export const fragmentSlots: FragmentSlotDefinition[] = [];",
    );
  });

  it("generates a slot entry with fields in FragmentSlotDefinition order", () => {
    const source = generateFragmentSlotsSource("page-home", [
      {
        name: "promotion",
        fragment: "promotion-banner",
        channel: "stable",
        strategy: "cached-ssr",
        timeoutMs: 200,
        props: { scene: "home", campaignId: "summer" },
        cachePolicy: { ttl: 60, tags: ["promotion", "home"] },
        dataDependencies: ["home-featured-content"],
        required: true,
      },
    ]);
    const slots = extractSlots(source);
    expect(slots).toEqual([
      {
        name: "promotion",
        fragment: "promotion-banner",
        channel: "stable",
        strategy: "cached-ssr",
        timeoutMs: 200,
        props: { scene: "home", campaignId: "summer" },
        cachePolicy: {
          ttl: 60,
          tags: ["promotion", "home"],
          vary: ["tenant", "locale", "experiment", "props"],
        },
        dataDependencies: ["home-featured-content"],
        required: true,
      },
    ]);
    // Field order in the emitted object literal follows FragmentSlotDefinition.
    const nameIndex = source.indexOf('"name"');
    const fragmentIndex = source.indexOf('"fragment"');
    const requiredIndex = source.indexOf('"required"');
    expect(nameIndex).toBeLessThan(fragmentIndex);
    expect(fragmentIndex).toBeLessThan(requiredIndex);
  });

  it("omits empty dependsOn/dataDependencies arrays instead of emitting []", () => {
    const source = generateFragmentSlotsSource("page-home", [
      { name: "recommendations", fragment: "recommendation-widget" },
    ]);
    expect(source).not.toContain("dependsOn");
    expect(source).not.toContain("dataDependencies");
  });

  it("drops slots marked reserved (hand-rendered placeholders)", () => {
    const source = generateFragmentSlotsSource("page-product", [
      { name: "recommendations", fragment: "recommendation-widget" },
      { name: "price-panel", fragment: "price-panel", reserved: true },
    ]);
    const slots = extractSlots(source) as Array<{ name: string }>;
    expect(slots.map((slot) => slot.name)).toEqual(["recommendations"]);
    expect(source).not.toContain("price-panel");
  });

  it("carries a static slot's staticHtml through untouched", () => {
    const html = '<section data-fragment="static-editorial-note"></section>';
    const source = generateFragmentSlotsSource("page-home", [
      {
        name: "staticEditorial",
        fragment: "static-editorial-note",
        strategy: "static",
        staticHtml: html,
      },
    ]);
    const [slot] = extractSlots(source) as Array<{ staticHtml: string }>;
    expect(slot.staticHtml).toBe(html);
  });

  it("references the manifest and the freshness-check command in the header", () => {
    const source = generateFragmentSlotsSource("page-home", []);
    expect(source).toContain("apps/page-home/src/manifest.slots.json");
    expect(source).toContain(
      "pnpm exec tsx scripts/mount-slot.mts --page page-home --check",
    );
    expect(source).toContain("GENERATED FILE");
    expect(source).toContain("import type { FragmentSlotDefinition }");
  });
});

describe("checkFragmentSlotsGenFileFreshness", () => {
  it("reports fresh when the on-disk content matches exactly", () => {
    expect(checkFragmentSlotsGenFileFreshness("same", "same")).toEqual({
      status: "fresh",
    });
  });

  it("reports stale when the on-disk content differs", () => {
    const result = checkFragmentSlotsGenFileFreshness("expected", "actual");
    expect(result).toEqual({
      status: "stale",
      expected: "expected",
      actual: "actual",
    });
  });

  it("reports stale when the file is missing on disk", () => {
    const result = checkFragmentSlotsGenFileFreshness("expected", null);
    expect(result.status).toBe("stale");
  });
});
