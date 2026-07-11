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
      packageDependencies: ["@mvp/interaction", "@mvp/trade-contracts"],
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
    // A domains/* unit (§ W1-A): modeled exactly like a packages/* unit —
    // fragments/order-form depends on it (see packageDependencies above), so
    // its reverse-dependency closure must reach order-form + page-trade.
    { name: "@mvp/trade-contracts", dir: "trade-contracts" },
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

  it("maps a modeled domains/* package to its unit (not global, not empty)", () => {
    // Regression test for the "silent under-build" bug: a domains/* change
    // used to fall through every branch (no fragments/apps/packages prefix
    // matched) and produce seeds=[] / global=false, which under-built.
    const { seeds, global } = seedsFromPaths(graph, [
      "domains/trade-contracts/src/index.ts",
    ]);
    expect(seeds).toEqual(["@mvp/trade-contracts"]);
    expect(global).toBe(false);
  });

  it("stays global for an unknown domains/* directory", () => {
    expect(
      seedsFromPaths(graph, ["domains/unknown-domain/src/index.ts"]).global,
    ).toBe(true);
  });

  it("stays global for an unrecognized top-level directory (not silently empty)", () => {
    // Regression guard: a top-level dir this resolver doesn't model at all
    // (not fragments/, apps/, packages/, domains/, and not on the ignored
    // list) must never silently produce an empty seed set.
    const { seeds, global } = seedsFromPaths(graph, ["newthing/file.ts"]);
    expect(global).toBe(true);
    expect(seeds).toEqual([]);
  });

  it("stays global for registry/routes code, root config, unknown packages", () => {
    expect(seedsFromPaths(graph, ["pnpm-lock.yaml"]).global).toBe(true);
    expect(
      seedsFromPaths(graph, ["packages/routes/src/registry.ts"]).global,
    ).toBe(true);
    expect(seedsFromPaths(graph, ["packages/unknown/src/x.ts"]).global).toBe(
      true,
    );
  });
});

const REGISTRY_DATA_PATH = "registry/registry.data.json";
const RELEASES_PATH = "registry/releases.json";

/** Builds a `getRegistryFileContent` resolver from a fixed before/after map,
 * mirroring what the CLI wires up from `git show <base>:<path>` + the
 * working tree (see scripts/affected-graph.mts). */
function registryReader(content: {
  [path: string]: { before?: string; after?: string };
}) {
  return (path: string) => ({
    before: content[path]?.before,
    after: content[path]?.after,
  });
}

const orderBookStable = {
  version: "0.1.0",
  serviceUrl: "http://localhost:4204",
  manifestUrl: "http://localhost:4204/manifest",
};
const orderBookCanary = {
  version: "0.2.0-beta.1",
  serviceUrl: "http://localhost:4204",
  manifestUrl: "http://localhost:4204/manifest",
};

describe("seedsFromPaths — registry data narrowing (§4.1)", () => {
  it("registering a brand-new fragment seeds only that fragment, not GLOBAL", () => {
    const before = JSON.stringify({
      fragments: { "order-book": { canary: orderBookCanary } },
    });
    const after = JSON.stringify({
      fragments: {
        "order-book": { canary: orderBookCanary },
        "order-form": { canary: orderBookCanary },
      },
    });
    const { seeds, global } = seedsFromPaths(graph, [REGISTRY_DATA_PATH], {
      getRegistryFileContent: registryReader({
        [REGISTRY_DATA_PATH]: { before, after },
      }),
    });
    expect(global).toBe(false);
    expect(seeds).toEqual(["order-form"]);
  });

  it("promoting a fragment (channel/version change) seeds only that fragment", () => {
    const before = JSON.stringify({
      fragments: {
        "order-book": { canary: orderBookCanary },
        "order-form": { canary: orderBookCanary },
      },
    });
    const after = JSON.stringify({
      fragments: {
        "order-book": { stable: orderBookStable, canary: orderBookCanary },
        "order-form": { canary: orderBookCanary },
      },
    });
    const { seeds, global } = seedsFromPaths(graph, [REGISTRY_DATA_PATH], {
      getRegistryFileContent: registryReader({
        [REGISTRY_DATA_PATH]: { before, after },
      }),
    });
    expect(global).toBe(false);
    expect(seeds).toEqual(["order-book"]);
  });

  it("falls back to GLOBAL when registry.data.json is malformed at either revision", () => {
    const validAfter = JSON.stringify({
      fragments: { "order-book": { canary: orderBookCanary } },
    });
    const malformedBefore = seedsFromPaths(graph, [REGISTRY_DATA_PATH], {
      getRegistryFileContent: registryReader({
        [REGISTRY_DATA_PATH]: { before: "{not json", after: validAfter },
      }),
    });
    expect(malformedBefore.global).toBe(true);

    const malformedAfter = seedsFromPaths(graph, [REGISTRY_DATA_PATH], {
      getRegistryFileContent: registryReader({
        [REGISTRY_DATA_PATH]: { before: validAfter, after: "{not json" },
      }),
    });
    expect(malformedAfter.global).toBe(true);
  });

  it("falls back to GLOBAL when no content resolver is supplied", () => {
    const { global } = seedsFromPaths(graph, [REGISTRY_DATA_PATH]);
    expect(global).toBe(true);
  });

  it("a code change under registry.ts (not the data file) still triggers GLOBAL", () => {
    const { global } = seedsFromPaths(graph, [
      "packages/registry/src/registry.ts",
    ]);
    expect(global).toBe(true);
  });

  it("a releases.json change seeds only the fragment(s) with a new release record", () => {
    const before = JSON.stringify({ releases: [] });
    const after = JSON.stringify({
      releases: [
        {
          unit: "fragment",
          name: "order-book",
          version: "0.1.0",
          channel: "stable",
          smokeTests: [],
          releasedAt: "2026-07-10T00:00:00.000Z",
        },
      ],
    });
    const { seeds, global } = seedsFromPaths(graph, [RELEASES_PATH], {
      getRegistryFileContent: registryReader({
        [RELEASES_PATH]: { before, after },
      }),
    });
    expect(global).toBe(false);
    expect(seeds).toEqual(["order-book"]);
  });

  it("narrowly-seeded registry changes still pull in the mounting page via affectedClosure", () => {
    const before = JSON.stringify({
      fragments: { "order-book": { canary: orderBookCanary } },
    });
    const after = JSON.stringify({
      fragments: {
        "order-book": { stable: orderBookStable, canary: orderBookCanary },
      },
    });
    const plan = affectedFromChangedPaths(graph, [REGISTRY_DATA_PATH], {
      getRegistryFileContent: registryReader({
        [REGISTRY_DATA_PATH]: { before, after },
      }),
    });
    expect(plan.global).toBe(false);
    expect(plan.deployables).toEqual(["order-book", "page-trade"]);
    expect(plan.affectedPages).toEqual(["page-trade"]);
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

  it("still rebuilds everything (+shell) on a root config change", () => {
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

  it("a domains/* change closes over its fragment + page dependents (not empty, not global)", () => {
    // Reproduces the reported bug directly: a change under domains/trade-contracts
    // must seed trade-contracts and its closure must include order-form (which
    // declares @mvp/trade-contracts as a package dependency) + page-trade
    // (which mounts order-form) — not an empty affected set.
    const plan = affectedFromChangedPaths(graph, [
      "domains/trade-contracts/src/index.ts",
    ]);
    expect(plan.global).toBe(false);
    expect(plan.seeds).toEqual(["@mvp/trade-contracts"]);
    expect(plan.deployables).toEqual(["order-form", "page-trade"]);
    expect(plan.affectedPages).toEqual(["page-trade"]);
  });
});
