import { describe, expect, it } from "vitest";
import {
  applyMountSlot,
  applyUnmountSlot,
  validatePageSlots,
} from "../src/slots";

const baseSlots = [
  {
    name: "promotion",
    fragment: "promotion-banner",
    channel: "stable",
    strategy: "cached-ssr",
    timeoutMs: 200,
    required: false,
  },
  {
    name: "price-panel",
    fragment: "price-panel",
    channel: "stable",
    required: false,
    reserved: true,
  },
];

describe("validatePageSlots", () => {
  it("accepts existing slot shapes including passthrough keys", () => {
    expect(validatePageSlots(baseSlots)).toEqual({ valid: true, errors: [] });
  });

  it("reports slots that violate the page manifest contract", () => {
    const result = validatePageSlots([{ name: "", fragment: "x" }]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("applyMountSlot", () => {
  it("appends a new slot", () => {
    const result = applyMountSlot(baseSlots, {
      name: "recommendations",
      fragment: "recommendation-widget",
      channel: "stable",
      strategy: "dynamic-ssr",
      timeoutMs: 200,
      required: false,
    });
    expect(result.changed).toBe(true);
    expect(result.action).toBe("added");
    expect(result.slots).toHaveLength(3);
    expect(result.slots[2]).toMatchObject({ name: "recommendations" });
    expect(baseSlots).toHaveLength(2);
  });

  it("updates an existing slot in place", () => {
    const result = applyMountSlot(baseSlots, {
      name: "promotion",
      fragment: "promotion-banner",
      channel: "canary",
      strategy: "cached-ssr",
      timeoutMs: 200,
      required: false,
    });
    expect(result.action).toBe("updated");
    expect(result.slots[0]).toMatchObject({ channel: "canary" });
    expect(result.slots).toHaveLength(2);
  });

  it("is idempotent for identical slots", () => {
    const result = applyMountSlot(baseSlots, { ...baseSlots[0] });
    expect(result.changed).toBe(false);
    expect(result.action).toBe("unchanged");
  });

  it("preserves passthrough keys on untouched slots", () => {
    const result = applyMountSlot(baseSlots, {
      name: "recommendations",
      fragment: "recommendation-widget",
    });
    expect(result.slots[1]).toMatchObject({ reserved: true });
  });

  it("rejects slots that violate the contract", () => {
    expect(() =>
      applyMountSlot(baseSlots, { name: "bad", fragment: "" }),
    ).toThrow();
    expect(() =>
      applyMountSlot(baseSlots, {
        name: "bad",
        fragment: "x",
        strategy: "no-such-strategy" as never,
      }),
    ).toThrow();
  });
});

describe("applyUnmountSlot", () => {
  it("removes a slot by name", () => {
    const result = applyUnmountSlot(baseSlots, "promotion");
    expect(result.changed).toBe(true);
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]).toMatchObject({ name: "price-panel" });
  });

  it("is a no-op for unknown slot names", () => {
    const result = applyUnmountSlot(baseSlots, "missing");
    expect(result.changed).toBe(false);
    expect(result.slots).toHaveLength(2);
  });
});
