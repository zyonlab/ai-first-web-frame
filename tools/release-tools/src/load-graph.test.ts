/**
 * Integration test for the filesystem loader (`loadUnitGraph`). Unlike
 * `unit-graph.test.ts` (pure, hand-built fixtures), this exercises the actual
 * directory-scanning logic against a throwaway repo skeleton on disk — the
 * layer where the "silent under-build" bug (W1-A) actually lived: `apps/`,
 * `fragments/`, `packages/` were scanned for workspace units, but `domains/`
 * was not, so a domain package never became a graph unit at all.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadFragmentManifest, loadUnitGraph } from "./load-graph";
import { affectedClosure } from "./unit-graph";

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

/**
 * A minimal manifest that satisfies `FragmentManifestSchema` (H1: the loader
 * now hard-validates instead of duck-typing "any object with a string name").
 * Includes a convention field (`layoutHint`) to prove `.passthrough()` keeps
 * out-of-contract fields flowing into the graph.
 */
function validManifestSource(name: string): string {
  return `export const manifest = ${JSON.stringify({
    name,
    version: "0.1.0",
    owner: "test",
    renderMode: "ssr",
    fallback: `<section>${name}</section>`,
    assets: { js: [], css: [] },
    budget: { scope: "fragment", name },
    layoutHint: { shape: "panel", minHeight: 120, fills: false },
  })};\n`;
}

// Fixture repos are created *inside* this package (not `os.tmpdir()`): the
// loader dynamically `import()`s fragment `manifest.ts` files, and under
// Vitest's SSR module runner that resolution is subject to Vite's dev-server
// `fs.allow` restriction, which rejects paths outside the workspace root.
// Each fixture directory is created fresh and removed in `afterEach`, so
// nothing is ever left on disk / committed.
const FIXTURE_PARENT = dirname(fileURLToPath(import.meta.url));

describe("loadUnitGraph — domains/", () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("models a domains/* package.json as a graph unit, wired into the fragment/page closure", async () => {
    root = mkdtempSync(join(FIXTURE_PARENT, ".load-graph-domains-fixture-"));

    // domains/trade-contracts — a domain package, same shape as packages/*.
    mkdirSync(join(root, "domains", "trade-contracts"), { recursive: true });
    writeJson(join(root, "domains", "trade-contracts", "package.json"), {
      name: "@mvp/trade-contracts",
      dependencies: {},
    });

    // fragments/order-form depends on @mvp/trade-contracts.
    mkdirSync(join(root, "fragments", "order-form", "src"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "fragments", "order-form", "src", "manifest.ts"),
      validManifestSource("order-form"),
    );
    writeJson(join(root, "fragments", "order-form", "package.json"), {
      name: "@mvp/fragment-order-form",
      dependencies: { "@mvp/trade-contracts": "workspace:*" },
    });

    // apps/page-trade mounts order-form.
    mkdirSync(join(root, "apps", "page-trade", "src"), { recursive: true });
    writeJson(join(root, "apps", "page-trade", "src", "manifest.slots.json"), [
      { name: "orderForm", fragment: "order-form" },
    ]);
    writeJson(join(root, "apps", "page-trade", "package.json"), {
      name: "@mvp/page-trade",
      dependencies: {},
    });

    const graph = await loadUnitGraph(root);

    const domainUnit = graph.units.find((u) => u.id === "@mvp/trade-contracts");
    expect(domainUnit?.kind).toBe("package");

    expect(graph.edges).toContainEqual({
      from: "order-form",
      to: "@mvp/trade-contracts",
      via: "uses-package",
    });

    // Reproduces the bug's symptom end-to-end: seeding the closure from the
    // domain unit must reach order-form + page-trade, not come back empty.
    const closureIds = affectedClosure(graph, ["@mvp/trade-contracts"]).map(
      (u) => u.id,
    );
    expect(closureIds).toEqual(
      expect.arrayContaining([
        "@mvp/trade-contracts",
        "order-form",
        "page-trade",
      ]),
    );
  });

  it("ignores a domains/* entry with no package.json", async () => {
    root = mkdtempSync(
      join(FIXTURE_PARENT, ".load-graph-domains-empty-fixture-"),
    );
    mkdirSync(join(root, "domains", "not-a-package"), { recursive: true });

    const graph = await loadUnitGraph(root);
    expect(graph.units.some((u) => u.name === "not-a-package")).toBe(false);
  });
});

describe("loadFragmentManifest — FragmentManifestSchema enforcement (H1)", () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("keeps out-of-contract convention fields via passthrough", async () => {
    root = mkdtempSync(join(FIXTURE_PARENT, ".load-graph-manifest-fixture-"));
    mkdirSync(join(root, "fragments", "price-panel", "src"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "fragments", "price-panel", "src", "manifest.ts"),
      validManifestSource("price-panel"),
    );

    const manifest = await loadFragmentManifest(root, "price-panel");
    expect(manifest?.name).toBe("price-panel");
    expect(manifest?.layoutHint).toEqual({
      shape: "panel",
      minHeight: 120,
      fills: false,
    });
  });

  it("throws a schema-named error for a malformed manifest instead of feeding it to the graph", async () => {
    root = mkdtempSync(join(FIXTURE_PARENT, ".load-graph-malformed-fixture-"));
    mkdirSync(join(root, "fragments", "broken-panel", "src"), {
      recursive: true,
    });
    // Duck-typing would have accepted this (string `name`), but it is missing
    // version/owner/renderMode/fallback/assets/budget.
    writeFileSync(
      join(root, "fragments", "broken-panel", "src", "manifest.ts"),
      'export const brokenPanelManifest = { name: "broken-panel", renderMode: "csr" };\n',
    );

    await expect(loadFragmentManifest(root, "broken-panel")).rejects.toThrow(
      /FragmentManifestSchema.*"broken-panel"/,
    );
    // ...and graph construction dies loudly with the same error.
    await expect(loadUnitGraph(root)).rejects.toThrow(/FragmentManifestSchema/);
  });
});
