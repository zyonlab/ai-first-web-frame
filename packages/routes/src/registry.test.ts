import { describe, expect, it } from "vitest";
import {
  buildRouteRegistry,
  matchRoute,
  routeRegistry,
  validateRouteRegistry,
} from "./registry";

describe("route registry", () => {
  it("passes schema validation", () => {
    expect(validateRouteRegistry(routeRegistry)).toBe(true);
  });

  it("applies a valid PAGE_*_URL env override to the route serviceUrl", () => {
    const registry = buildRouteRegistry({
      PAGE_TRADE_URL: "http://page-trade:4103",
    });
    expect(
      registry.routes.find((route) => route.id === "trade")?.serviceUrl,
    ).toBe("http://page-trade:4103");
    // Routes without an override keep their defaults.
    expect(
      registry.routes.find((route) => route.id === "home")?.serviceUrl,
    ).toBe("http://localhost:4101");
  });

  it("throws a schema-named error for a garbage PAGE_*_URL override", () => {
    expect(() => buildRouteRegistry({ PAGE_TRADE_URL: "not-a-url" })).toThrow(
      /RouteManifestSchema.*PAGE_TRADE_URL="not-a-url"/,
    );
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
