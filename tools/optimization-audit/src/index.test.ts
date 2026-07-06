import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findPageManifestSlots,
  parseSlotsFromJsonSource,
  parseSlotsFromManifestSource,
  runOptimizationAudit,
} from "./index";

const roots: string[] = [];

function tempRoot(name: string): string {
  const root = join(
    tmpdir(),
    `mvp-optimization-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

const tsManifest = `export const pageManifest = {
  slots: [
    { name: "recommendations", fragment: "recommendation-widget", strategy: "dynamic-ssr" },
  ],
  budget: {}
};`;

function auditOptions(root: string) {
  return { ci: true, warnOnly: false, force: false, root, positional: [] };
}

function duplicateTraceLine(traceId: string): string {
  return JSON.stringify({
    traceId,
    startedAtMs: 0,
    endedAtMs: 10,
    nodes: [
      {
        id: "request-a",
        name: "request:catalog",
        kind: "network",
        startedAtMs: 1,
        endedAtMs: 2,
        status: "ok",
        attributes: { url: "https://api.example.test/catalog" },
      },
      {
        id: "request-b",
        name: "request:catalog",
        kind: "network",
        startedAtMs: 3,
        endedAtMs: 4,
        status: "ok",
        attributes: { url: "https://api.example.test/catalog" },
      },
    ],
    edges: [],
  });
}

describe("optimization-audit", () => {
  it("parses page manifest slot candidates from TS source", () => {
    const slots = parseSlotsFromManifestSource(`
      export const pageManifest = {
        slots: [
          { name: "hero", fragment: "hero-fragment", strategy: "static" },
          { name: "recommendations", fragment: "recommendation-widget", strategy: "dynamic-ssr", dependsOn: ["hero"] },
        ],
        budget: {}
      };
    `);
    expect(slots).toEqual([
      {
        name: "hero",
        fragment: "hero-fragment",
        strategy: "static",
        dependsOn: [],
      },
      {
        name: "recommendations",
        fragment: "recommendation-widget",
        strategy: "dynamic-ssr",
        dependsOn: ["hero"],
      },
    ]);
  });

  it("parses slot candidates from JSON slot files", () => {
    const asObject = parseSlotsFromJsonSource(
      JSON.stringify({
        slots: [
          { name: "hero", fragment: "hero-fragment", strategy: "static" },
          {
            name: "recommendations",
            fragment: "recommendation-widget",
            strategy: "dynamic-ssr",
            dependsOn: ["hero"],
          },
          { name: "broken" },
        ],
      }),
    );
    expect(asObject).toEqual([
      {
        name: "hero",
        fragment: "hero-fragment",
        strategy: "static",
        dependsOn: [],
      },
      {
        name: "recommendations",
        fragment: "recommendation-widget",
        strategy: "dynamic-ssr",
        dependsOn: ["hero"],
      },
    ]);
    const asArray = parseSlotsFromJsonSource(
      JSON.stringify([{ name: "hero", fragment: "hero-fragment" }]),
    );
    expect(asArray).toEqual([
      { name: "hero", fragment: "hero-fragment", dependsOn: [] },
    ]);
    expect(parseSlotsFromJsonSource("not json")).toEqual([]);
  });

  it("discovers slots from JSON files first and falls back to TS manifests", () => {
    const root = tempRoot("discovery");
    // page-home migrated to a JSON slots file; the stale TS manifest must be ignored.
    write(
      join(root, "apps/page-home/src/manifest.slots.json"),
      JSON.stringify({
        slots: [
          { name: "hero", fragment: "hero-fragment", strategy: "dynamic-ssr" },
        ],
      }),
    );
    write(
      join(root, "apps/page-home/src/manifest.ts"),
      `export const pageManifest = { slots: [ { name: "stale", fragment: "stale-fragment" } ], budget: {} };`,
    );
    // page-product still uses the legacy TS manifest.
    write(join(root, "apps/page-product/src/manifest.ts"), tsManifest);

    const slots = findPageManifestSlots(root);
    expect(slots).toEqual([
      {
        name: "hero",
        fragment: "hero-fragment",
        strategy: "dynamic-ssr",
        dependsOn: [],
        manifestPath: "apps/page-home/src/manifest.slots.json",
      },
      {
        name: "recommendations",
        fragment: "recommendation-widget",
        strategy: "dynamic-ssr",
        dependsOn: [],
        manifestPath: "apps/page-product/src/manifest.ts",
      },
    ]);
    expect(slots.some((slot) => slot.name === "stale")).toBe(false);
  });

  it("writes optimization finding reports with manifest locations", () => {
    const root = tempRoot("report");
    write(join(root, "apps/page-home/src/manifest.ts"), tsManifest);
    const report = runOptimizationAudit(auditOptions(root));
    expect(report.findings.map((finding) => finding.id)).toContain(
      "static-slot-recommendations",
    );
    const slotFinding = report.findings.find(
      (finding) => finding.id === "static-slot-recommendations",
    );
    expect(slotFinding?.location).toEqual({
      slotName: "recommendations",
      fragmentName: "recommendation-widget",
      manifestPath: "apps/page-home/src/manifest.ts",
    });
    const markdown = readFileSync(
      join(root, "reports/optimization-findings.md"),
      "utf8",
    );
    expect(markdown).toContain("Optimization Findings");
    expect(markdown).toContain("manifestPath=apps/page-home/src/manifest.ts");
  });

  it("declares explicitly when no runtime traces are found", () => {
    const root = tempRoot("no-traces");
    write(join(root, "apps/page-home/src/manifest.ts"), tsManifest);
    const report = runOptimizationAudit(auditOptions(root));
    expect(report.traces.note).toBe(
      "no runtime traces found; trace-based rules skipped",
    );
    expect(report.traces.snapshotCount).toBe(0);
    const markdown = readFileSync(
      join(root, "reports/optimization-findings.md"),
      "utf8",
    );
    expect(markdown).toContain(
      "no runtime traces found; trace-based rules skipped",
    );
  });

  it("consumes JSONL traces and emits trace-based findings with evidence", () => {
    const root = tempRoot("traces");
    write(join(root, "apps/page-home/src/manifest.ts"), tsManifest);
    write(
      join(root, "reports/traces/traces.jsonl"),
      `${duplicateTraceLine("trace-1")}\nbroken-line\n${duplicateTraceLine("trace-2")}\n`,
    );
    const report = runOptimizationAudit(auditOptions(root));
    expect(report.traces).toMatchObject({
      dir: "reports/traces",
      filesRead: 1,
      snapshotCount: 2,
      skippedLines: 1,
    });
    expect(report.traces.note).toBeUndefined();
    const duplicate = report.findings.find((finding) =>
      finding.id.startsWith("duplicate-network-"),
    );
    expect(duplicate).toBeDefined();
    expect(duplicate?.severity).toBe("high");
    expect(duplicate?.traceEvidence?.map((entry) => entry.traceId)).toEqual([
      "trace-1",
      "trace-2",
    ]);
    const markdown = readFileSync(
      join(root, "reports/optimization-findings.md"),
      "utf8",
    );
    expect(markdown).toContain("## HIGH (1)");
    expect(markdown).toContain("trace trace-1 spans request-a, request-b");
    expect(markdown).toContain("2 snapshot(s) from reports/traces");
    expect(markdown.indexOf("## HIGH")).toBeLessThan(
      markdown.indexOf("## INFO"),
    );
  });

  it("honors a custom trace directory", () => {
    const root = tempRoot("custom-dir");
    write(join(root, "apps/page-home/src/manifest.ts"), tsManifest);
    write(
      join(root, "custom-traces/run.jsonl"),
      `${duplicateTraceLine("trace-x")}\n`,
    );
    const report = runOptimizationAudit(auditOptions(root), {
      traceDir: join(root, "custom-traces"),
    });
    expect(report.traces.dir).toBe("custom-traces");
    expect(report.traces.snapshotCount).toBe(1);
    expect(
      report.findings.some((finding) =>
        finding.id.startsWith("duplicate-network-"),
      ),
    ).toBe(true);
  });
});
