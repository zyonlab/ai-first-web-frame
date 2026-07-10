import { describe, expect, it } from "vitest";
import {
  applyMountSlot,
  applyUnmountSlot,
  checkFragmentRegistered,
  diffManifestAgainstRuntime,
  type RuntimeSlotContract,
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

describe("checkFragmentRegistered", () => {
  const registry = { fragments: { "promotion-banner": {} } };

  it("passes for registered fragments with no warnings", () => {
    const result = checkFragmentRegistered(registry, "promotion-banner", false);
    expect(result).toEqual({ ok: true, warnings: [] });
  });

  it("refuses unregistered fragments with an actionable error", () => {
    const result = checkFragmentRegistered(registry, "price-panel", false);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed check");
    expect(result.error).toContain('"price-panel"');
    expect(result.error).toContain("register-fragment");
    expect(result.error).toContain("--allow-unregistered");
  });

  it("warns but proceeds when allowUnregistered is set", () => {
    const result = checkFragmentRegistered(registry, "price-panel", true);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a passing check");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("price-panel");
    expect(result.warnings[0]).toContain("--allow-unregistered");
  });
});

describe("diffManifestAgainstRuntime", () => {
  const manifestSlots = [
    {
      name: "promotion",
      fragment: "promotion-banner",
      channel: "stable",
      strategy: "cached-ssr",
      timeoutMs: 200,
      required: true,
    },
    {
      name: "price-panel",
      fragment: "price-panel",
      channel: "stable",
      required: false,
      reserved: true,
    },
  ];

  const runtimeSlots: RuntimeSlotContract[] = [
    {
      name: "promotion",
      fragment: "promotion-banner",
      channel: "stable",
      strategy: "cached-ssr",
      timeoutMs: 200,
      required: true,
    },
  ];

  it("reports no drift when a reserved manifest slot is correctly absent from the runtime array", () => {
    expect(diffManifestAgainstRuntime(manifestSlots, runtimeSlots)).toEqual([]);
  });

  it("flags drift when a reserved manifest slot is wired into the runtime array", () => {
    const result = diffManifestAgainstRuntime(manifestSlots, [
      ...runtimeSlots,
      { name: "price-panel", fragment: "price-panel", channel: "stable" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("price-panel");
    expect(result[0]).toContain("reserved");
  });

  it("flags drift on a required mismatch", () => {
    const result = diffManifestAgainstRuntime(manifestSlots, [
      { ...runtimeSlots[0], required: false },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("promotion");
    expect(result[0]).toContain("required");
  });

  it("flags drift when a non-reserved manifest slot has no runtime entry", () => {
    const result = diffManifestAgainstRuntime(manifestSlots, []);
    expect(result).toContain(
      'slot "promotion" is declared in the manifest but missing from the runtime slots array',
    );
  });

  it("flags drift when a runtime slot has no corresponding manifest entry", () => {
    const result = diffManifestAgainstRuntime(manifestSlots, [
      ...runtimeSlots,
      { name: "recommendations", fragment: "recommendation-widget" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("recommendations");
    expect(result[0]).toContain("missing from the manifest");
  });

  it("reports no drift for fully matching slots, applying runtime defaults for omitted fields", () => {
    const matchingManifest = [
      { name: "staticEditorial", fragment: "static-editorial-note" },
    ];
    const matchingRuntime: RuntimeSlotContract[] = [
      { name: "staticEditorial", fragment: "static-editorial-note" },
    ];
    expect(
      diffManifestAgainstRuntime(matchingManifest, matchingRuntime),
    ).toEqual([]);
  });

  it("flags drift on fragment/channel/strategy/timeoutMs mismatches", () => {
    const result = diffManifestAgainstRuntime(
      [
        {
          name: "promotion",
          fragment: "promotion-banner",
          channel: "canary",
          strategy: "dynamic-ssr",
          timeoutMs: 500,
          required: true,
        },
      ],
      [{ ...runtimeSlots[0] }],
    );
    expect(result.some((message) => message.includes("channel"))).toBe(true);
    expect(result.some((message) => message.includes("strategy"))).toBe(true);
    expect(result.some((message) => message.includes("timeoutMs"))).toBe(true);
  });
});
