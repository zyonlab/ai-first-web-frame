import { describe, expect, it } from "vitest";
import { layoutAdvisories } from "./layout-advisories";

const ctx = { fragment: "order-book", slot: "book" };

describe("layoutAdvisories", () => {
  it("nudges to add a hint when the fragment declares none", () => {
    const out = layoutAdvisories(undefined, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("declares no layoutHint");
  });

  it("warns a fills fragment must go in a stretching cell (490px-void class)", () => {
    const out = layoutAdvisories(
      { shape: "ladder", fills: true, minHeight: 300 },
      ctx,
    );
    expect(
      out.some((a) => a.includes("fills its pane") && a.includes("STRETCHES")),
    ).toBe(true);
    expect(out.some((a) => a.includes("minHeight ≥ 300px"))).toBe(true);
    expect(out.some((a) => a.includes("verify:runtime"))).toBe(true);
  });

  it("does not warn about fills for a non-filling panel", () => {
    const out = layoutAdvisories({ shape: "panel" }, ctx);
    expect(out.some((a) => a.includes("fills its pane"))).toBe(false);
    expect(out.some((a) => a.includes("minHeight"))).toBe(false);
  });

  it("surfaces an aspect preference when set", () => {
    const out = layoutAdvisories({ shape: "chart", aspect: 1.6 }, ctx);
    expect(out.some((a) => a.includes("aspect 1.6"))).toBe(true);
  });
});
