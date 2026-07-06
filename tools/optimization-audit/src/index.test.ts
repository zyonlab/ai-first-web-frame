import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSlotsFromManifestSource, runOptimizationAudit } from "./index";

function tempRoot(name: string): string {
  const root = join(
    tmpdir(),
    `mvp-optimization-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  return root;
}

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

describe("optimization-audit", () => {
  it("parses page manifest slot candidates", () => {
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

  it("writes optimization finding reports", () => {
    const root = tempRoot("report");
    write(
      join(root, "apps/page-home/src/manifest.ts"),
      `export const pageManifest = {
        slots: [
          { name: "recommendations", fragment: "recommendation-widget", strategy: "dynamic-ssr" },
        ],
        budget: {}
      };`,
    );
    const report = runOptimizationAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(report.findings.map((finding) => finding.id)).toContain(
      "static-slot-recommendations",
    );
    expect(
      readFileSync(join(root, "reports/optimization-findings.md"), "utf8"),
    ).toContain("Optimization Findings");
    rmSync(root, { recursive: true, force: true });
  });
});
