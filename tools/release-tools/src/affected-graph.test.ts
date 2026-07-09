import { describe, expect, it } from "vitest";
import {
  affectedFromChangedPaths,
  SHELL_UNIT,
  seedsFromPaths,
} from "./affected-graph";
import { buildUnitGraph } from "./unit-graph";

const graph = buildUnitGraph({
  fragments: [
    {
      name: "order-book",
      dataDependencies: ["book.l2.<symbol>"],
      produces: { slices: ["trade.order-draft.price"] },
    },
    {
      name: "order-form",
      dataDependencies: ["account"],
      consumes: { slices: ["trade.order-draft.price"] },
    },
    { name: "promotion-banner" },
  ],
  pages: [
    {
      name: "page-trade",
      slots: [
        { name: "book", fragment: "order-book" },
        { name: "orderForm", fragment: "order-form" },
      ],
    },
    {
      name: "page-home",
      slots: [{ name: "promo", fragment: "promotion-banner" }],
    },
  ],
  routes: [
    { path: "/trade/:symbol", page: "page-trade" },
    { path: "/", page: "page-home" },
  ],
});

describe("seedsFromPaths", () => {
  it("resolves fragment + app paths, ignores non-shipping paths", () => {
    const { seeds, global } = seedsFromPaths(graph, [
      "fragments/order-book/src/render.ts",
      "apps/page-trade/src/gridStyles.ts",
      "docs/AI_NATIVE_DEVX.md",
      "e2e/foo.spec.ts",
      "fragments/order-book/README.md",
    ]);
    expect(seeds).toEqual(["order-book", "page-trade"]);
    expect(global).toBe(false);
  });

  it("marks shared roots (packages / platform / root config) as global", () => {
    expect(
      seedsFromPaths(graph, ["packages/interaction/src/index.ts"]).global,
    ).toBe(true);
    expect(seedsFromPaths(graph, ["pnpm-lock.yaml"]).global).toBe(true);
    expect(
      seedsFromPaths(graph, ["platform/route-registry/src/registry.ts"]).global,
    ).toBe(true);
  });
});

describe("affectedFromChangedPaths", () => {
  it("expands a fragment change to its page + siblings by graph closure", () => {
    const plan = affectedFromChangedPaths(graph, [
      "fragments/order-book/src/render.ts",
    ]);
    expect(plan.global).toBe(false);
    // order-book → its page; the page mounts order-form too, but order-form is
    // NOT rebuilt (it didn't change) — only the changed unit + its dependents.
    expect(plan.deployables).toEqual(["order-book", "page-trade"]);
    expect(plan.affectedPages).toEqual(["page-trade"]);
  });

  it("a shared-package change rebuilds everything (+shell)", () => {
    const plan = affectedFromChangedPaths(graph, [
      "packages/interaction/src/index.ts",
    ]);
    expect(plan.global).toBe(true);
    expect(plan.deployables).toContain(SHELL_UNIT);
    expect(plan.deployables).toContain("order-book");
    expect(plan.deployables).toContain("page-home");
    expect(plan.affectedPages.sort()).toEqual(["page-home", "page-trade"]);
  });

  it("an app-only change rebuilds just that page", () => {
    const plan = affectedFromChangedPaths(graph, [
      "apps/page-home/src/manifest.slots.json",
    ]);
    expect(plan.deployables).toEqual(["page-home"]);
  });
});
