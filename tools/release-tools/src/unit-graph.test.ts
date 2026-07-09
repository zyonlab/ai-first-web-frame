import { describe, expect, it } from "vitest";
import {
  type BuildUnitGraphInput,
  buildUnitGraph,
  consumersOfDataSource,
  dependenciesOf,
  dependentsOf,
  queryRegistry,
  unitsByKind,
} from "./unit-graph";

const fixture: BuildUnitGraphInput = {
  fragments: [
    {
      name: "order-book",
      owner: "trading-core",
      version: "0.1.0",
      renderStrategy: "dynamic-ssr",
      dependsOn: [],
      dataDependencies: ["book.l2.<symbol>"],
    },
    {
      name: "order-form",
      owner: "trading-core",
      version: "0.1.0",
      dependsOn: [],
      dataDependencies: ["account"],
    },
    {
      name: "market-header",
      owner: "trading-core",
      dataDependencies: ["ticker.<symbol>", "funding.<symbol>"],
    },
  ],
  pages: [
    {
      name: "page-trade",
      owner: "trading-core",
      slots: [
        { name: "book", fragment: "order-book" },
        { name: "orderForm", fragment: "order-form" },
        { name: "marketHeader", fragment: "market-header" },
      ],
    },
  ],
  routes: [{ path: "/trade/:symbol", page: "page-trade" }],
  registry: {
    "order-book": {
      canary: { version: "0.2.0-beta.1", serviceUrl: "http://localhost:4204" },
      stable: { version: "0.1.0", serviceUrl: "http://localhost:4204" },
    },
  },
};

describe("buildUnitGraph", () => {
  it("emits a unit per fragment/page/route/data-source, deterministically sorted", () => {
    const g = buildUnitGraph(fixture);
    expect(unitsByKind(g, "component").map((u) => u.id)).toEqual([
      "market-header",
      "order-book",
      "order-form",
    ]);
    expect(unitsByKind(g, "page").map((u) => u.id)).toEqual(["page-trade"]);
    expect(unitsByKind(g, "route").map((u) => u.id)).toEqual([
      "route:/trade/:symbol",
    ]);
    expect(unitsByKind(g, "data-source").map((u) => u.id)).toEqual([
      "account",
      "book.l2.<symbol>",
      "funding.<symbol>",
      "ticker.<symbol>",
    ]);
  });

  it("prefers the canary registry record for version/channel/serviceUrl", () => {
    const g = buildUnitGraph(fixture);
    const ob = g.units.find((u) => u.id === "order-book");
    expect(ob?.channel).toBe("canary");
    expect(ob?.version).toBe("0.2.0-beta.1");
    expect(ob?.serviceUrl).toBe("http://localhost:4204");
  });

  it("wires mounts / reads / routes edges", () => {
    const g = buildUnitGraph(fixture);
    expect(g.edges).toContainEqual({
      from: "page-trade",
      to: "order-book",
      via: "mounts",
    });
    expect(g.edges).toContainEqual({
      from: "order-book",
      to: "book.l2.<symbol>",
      via: "reads",
    });
    expect(g.edges).toContainEqual({
      from: "route:/trade/:symbol",
      to: "page-trade",
      via: "routes",
    });
  });
});

describe("graph queries", () => {
  const g = buildUnitGraph(fixture);

  it("dependentsOf finds who breaks if a unit changes", () => {
    // The page mounts order-book, so the page is a dependent.
    expect(dependentsOf(g, "order-book").map((u) => u.id)).toContain(
      "page-trade",
    );
  });

  it("dependenciesOf lists what a unit points at", () => {
    const deps = dependenciesOf(g, "page-trade").map((u) => u.id);
    expect(deps).toEqual(
      expect.arrayContaining(["order-book", "order-form", "market-header"]),
    );
  });

  it("consumersOfDataSource matches by source-id prefix (template-aware)", () => {
    // A concrete "book.l2" query finds the fragment declaring "book.l2.<symbol>".
    expect(consumersOfDataSource(g, "book.l2").map((u) => u.id)).toEqual([
      "order-book",
    ]);
    expect(consumersOfDataSource(g, "ticker.ETH").map((u) => u.id)).toEqual([
      "market-header",
    ]);
  });

  it("queryRegistry combines filters and returns the touching edges", () => {
    const res = queryRegistry(g, { kind: "component" });
    expect(res.units.every((u) => u.kind === "component")).toBe(true);
    const byName = queryRegistry(g, { name: "order-book" });
    expect(byName.units).toHaveLength(1);
    expect(byName.edges.length).toBeGreaterThan(0);
  });
});
