import { describe, expect, it } from "vitest";
import {
  fragmentRegistry,
  resolveFragment,
  validateFragmentRegistry,
} from "../src/registry";

describe("fragment registry", () => {
  it("passes schema validation", () => {
    expect(validateFragmentRegistry(fragmentRegistry)).toBe(true);
  });

  it("resolves stable channel", () => {
    expect(resolveFragment("promotion-banner", "stable")?.version).toBe(
      "0.1.0",
    );
  });

  it("resolves canary channel", () => {
    expect(resolveFragment("promotion-banner", "canary")?.version).toBe(
      "0.2.0-beta.1",
    );
  });

  it("resolves explicit versions", () => {
    expect(resolveFragment("recommendation-widget", "0.1.0")?.serviceUrl).toBe(
      "http://localhost:4202",
    );
  });

  it("returns null for unknown explicit versions", () => {
    expect(resolveFragment("recommendation-widget", "9.9.9")).toBeNull();
  });
});
