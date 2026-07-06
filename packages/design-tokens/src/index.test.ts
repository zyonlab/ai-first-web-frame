import { describe, expect, it } from "vitest";
import { createCssVariables, tokens } from "./index";

describe("@mvp/design-tokens", () => {
  it("keeps token keys unique and stable", () => {
    const keys = Object.entries(tokens).flatMap(([group, values]) =>
      Object.keys(values).map((key) => `${group}.${key}`),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("color.accent");
  });

  it("creates prefixed CSS variables without global CSS files", () => {
    expect(createCssVariables()).toContain("--mvp-color-accent");
  });
});
