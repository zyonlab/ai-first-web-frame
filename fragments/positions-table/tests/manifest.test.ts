import { describe, expect, it } from "vitest";
import { positionsTableBudget } from "../src/budget";
import {
  positionsTableManifest,
  validatePositionsTableManifest,
} from "../src/manifest";

describe("positions-table manifest", () => {
  it("declares a realtime dynamic-ssr fragment with no TTL", () => {
    expect(positionsTableManifest.name).toBe("positions-table");
    expect(positionsTableManifest.renderMode).toBe("ssr");
    expect(positionsTableManifest.renderStrategy).toBe("dynamic-ssr");
    expect(positionsTableManifest.cachePolicy.ttl).toBe(0);
    expect(validatePositionsTableManifest()).toBe(true);
  });

  it("declares only its own patch asset (no React, no dead placeholders)", () => {
    expect(positionsTableManifest.assets.js).toEqual([
      "/assets/positions-table.patch.js",
    ]);
    expect(positionsTableManifest.assets.js).not.toContain("@mvp/trade-client");
    expect(positionsTableManifest.assets.css).toContain(
      "/assets/positions-table.css",
    );
  });

  it("depends on the C5 global `positions` source", () => {
    expect(positionsTableManifest.dataDependencies).toEqual(["positions"]);
  });

  it("stays within the patch-only fragment budget (JS 30KB / CSS 10KB)", () => {
    expect(positionsTableBudget.scope).toBe("fragment");
    expect(positionsTableBudget.jsBytes).toBeLessThanOrEqual(30_000);
    expect(positionsTableBudget.cssBytes).toBeLessThanOrEqual(10_000);
  });
});
