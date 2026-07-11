import { describe, expect, it } from "vitest";
import registryData from "../../../registry/registry.data.json";
import {
  buildFragmentRegistry,
  fragmentEnvVarName,
  fragmentRegistry,
  resolveFragment,
  validateFragmentRegistry,
} from "./registry";

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

  it("loads entries from the JSON data file", () => {
    expect(Object.keys(fragmentRegistry.fragments)).toEqual(
      Object.keys(registryData.fragments),
    );
  });

  it("derives env var names from fragment names", () => {
    expect(fragmentEnvVarName("promotion-banner")).toBe("PROMOTION_BANNER_URL");
    expect(fragmentEnvVarName("recommendation-widget")).toBe(
      "RECOMMENDATION_WIDGET_URL",
    );
  });

  it("applies env overrides to service and manifest URLs", () => {
    const registry = buildFragmentRegistry(registryData, {
      PROMOTION_BANNER_URL: "http://promotion-banner:4201",
    });
    expect(resolveFragment("promotion-banner", "stable", registry)).toEqual({
      version: "0.1.0",
      serviceUrl: "http://promotion-banner:4201",
      manifestUrl: "http://promotion-banner:4201/manifest",
    });
    expect(resolveFragment("promotion-banner", "canary", registry)).toEqual({
      version: "0.2.0-beta.1",
      serviceUrl: "http://promotion-banner:4201",
      manifestUrl: "http://promotion-banner:4201/manifest",
    });
    expect(
      resolveFragment("recommendation-widget", "stable", registry)?.serviceUrl,
    ).toBe("http://localhost:4202");
  });

  it("throws a schema-named error for a garbage env override instead of splicing it in", () => {
    expect(() =>
      buildFragmentRegistry(registryData, {
        PROMOTION_BANNER_URL: "not-a-url",
      }),
    ).toThrow(/FragmentRegistryEntrySchema.*PROMOTION_BANNER_URL="not-a-url"/);
  });

  it("treats an empty env override as no override", () => {
    const registry = buildFragmentRegistry(registryData, {
      PROMOTION_BANNER_URL: "",
    });
    expect(
      resolveFragment("promotion-banner", "stable", registry)?.serviceUrl,
    ).toBe("http://localhost:4201");
  });

  it("resolves pinned versions from the versions record", () => {
    const registry = buildFragmentRegistry({
      fragments: {
        "promotion-banner": {
          stable: {
            version: "0.2.0",
            serviceUrl: "http://localhost:4201",
            manifestUrl: "http://localhost:4201/manifest",
          },
          versions: {
            "0.1.0": {
              version: "0.1.0",
              serviceUrl: "http://localhost:4201",
              manifestUrl: "http://localhost:4201/manifest",
            },
          },
        },
      },
    });
    expect(
      resolveFragment("promotion-banner", "0.1.0", registry)?.version,
    ).toBe("0.1.0");
  });

  it("rejects registries that fail schema validation", () => {
    expect(() =>
      buildFragmentRegistry({
        fragments: {
          broken: {
            stable: { version: "", serviceUrl: "x", manifestUrl: "y" },
          },
        },
      }),
    ).toThrow();
  });

  it("flags invalid registries in validateFragmentRegistry", () => {
    expect(
      validateFragmentRegistry({
        fragments: {
          broken: {
            stable: {
              version: "0.1.0",
              serviceUrl: "not-a-url",
              manifestUrl: "not-a-url",
            },
          },
        },
      }),
    ).toBe(false);
    expect(validateFragmentRegistry({ fragments: { empty: {} } })).toBe(false);
  });
});
