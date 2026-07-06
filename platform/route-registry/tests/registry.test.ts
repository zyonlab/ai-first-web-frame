import { describe, expect, it } from "vitest";
import {
  matchRoute,
  routeRegistry,
  validateRouteRegistry,
} from "../src/registry";

describe("route registry", () => {
  it("passes schema validation", () => {
    expect(validateRouteRegistry(routeRegistry)).toBe(true);
  });

  it("matches the home route", () => {
    expect(matchRoute("/")?.id).toBe("home");
  });

  it("matches product detail routes", () => {
    expect(matchRoute("/product/123")?.id).toBe("product");
  });

  it("returns null for unknown paths", () => {
    expect(matchRoute("/missing")).toBeNull();
  });
});
