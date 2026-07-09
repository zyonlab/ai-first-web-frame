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
      packageDependencies: ["@mvp/data"],
    },
    {
      name: "order-form",
      dataDependencies: ["account"],
      consumes: { slices: ["trade.order-draft.price"] },
      packageDependencies: ["@mvp/interaction"],
    },
    { name: "promotion-banner", packageDependencies: ["@mvp/runtime"] },
  ],
  pages: [
    {
      name: "page-trade",
      slots: [
        { name: "book", fragment: "order-book" },
        { name: "orderForm", fragment: "order-form" },
      ],
      packageDependencies: ["@mvp/interaction"],
    },
    {
      name: "page-home",
      slots: [{ name: "promo", fragment: "promotion-banner" }],
      packageDependencies: ["@mvp/runtime"],
    },
  ],
  packages: [
    {
      name: "@mvp/interaction",
      dir: "interaction",
      dependsOn: ["@mvp/contracts"],
    },
    { name: "@mvp/data", dir: "data" },
    { name: "@mvp/runtime", dir: "runtime" },
    { name: "@mvp/contracts", dir: "contracts" },
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

  it("maps a modeled workspace package to its unit (not global)", () => {
    const { seeds, global } = seedsFromPaths(graph, [
      "packages/interaction/src/index.ts",
    ]);
    expect(seeds).toEqual(["@mvp/interaction"]);
    expect(global).toBe(false);
  });

  it("stays global for platform / root config / unknown packages", () => {
    expect(seedsFromPaths(graph, ["pnpm-lock.yaml"]).global).toBe(true);
    expect(
      seedsFromPaths(graph, ["platform/route-registry/src/registry.ts"]).global,
    ).toBe(true);
    expect(seedsFromPaths(graph, ["packages/unknown/src/x.ts"]).global).toBe(
      true,
    );
  });
});

describe("affectedFromChangedPaths", () => {
  it("expands a fragment change to its page, not siblings", () => {
    const plan = affectedFromChangedPaths(graph, [
      "fragments/order-book/src/render.ts",
    ]);
    expect(plan.global).toBe(false);
    expect(plan.deployables).toEqual(["order-book", "page-trade"]);
    expect(plan.affectedPages).toEqual(["page-trade"]);
  });

  it("narrows a package change to only its dependents (was GLOBAL before)", () => {
    // @mvp/interaction is used by order-form + page-trade — NOT order-book
    // (which uses @mvp/data) or page-home.
    const plan = affectedFromChangedPaths(graph, [
      "packages/interaction/src/index.ts",
    ]);
    expect(plan.global).toBe(false);
    expect(plan.deployables).toEqual(["order-form", "page-trade"]);
    expect(plan.affectedPages).toEqual(["page-trade"]);
  });

  it("walks transitive package deps (contracts → interaction → its users)", () => {
    const plan = affectedFromChangedPaths(graph, [
      "packages/contracts/src/index.ts",
    ]);
    expect(plan.global).toBe(false);
    expect(plan.deployables).toEqual(["order-form", "page-trade"]);
  });

  it("still rebuilds everything (+shell) on a platform/root change", () => {
    const plan = affectedFromChangedPaths(graph, ["pnpm-lock.yaml"]);
    expect(plan.global).toBe(true);
    expect(plan.deployables).toContain(SHELL_UNIT);
    expect(plan.deployables).toContain("order-book");
    expect(plan.deployables).toContain("page-home");
  });

  it("an app-only change rebuilds just that page", () => {
    const plan = affectedFromChangedPaths(graph, [
      "apps/page-home/src/manifest.slots.json",
    ]);
    expect(plan.deployables).toEqual(["page-home"]);
  });
});
