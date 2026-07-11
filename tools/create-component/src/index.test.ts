import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCreateComponent } from "./index";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "mvp-create-component-"));
}

describe("@mvp/create-component", () => {
  it("generates a UI component skeleton with required files", () => {
    const root = tempRoot();
    const result = runCreateComponent({
      root,
      positional: ["ProductBadge"],
      type: "ui",
      ci: false,
      warnOnly: false,
      force: false,
    });
    expect(result.status).toBe("created");
    expect(result.files.some((file) => file.endsWith("metadata.ts"))).toBe(
      true,
    );
    expect(
      readFileSync(
        join(root, "packages/ui/src/ProductBadge/ProductBadge.test.tsx"),
        "utf8",
      ),
    ).toContain("renders label");
  });

  it("generates a fragment skeleton with required files", () => {
    const root = tempRoot();
    const result = runCreateComponent({
      root,
      positional: ["PromotionCard"],
      type: "fragment",
      ci: false,
      warnOnly: false,
      force: false,
    });
    expect(result.status).toBe("created");
    expect(
      readFileSync(join(root, "fragments/promotion-card/Dockerfile"), "utf8"),
    ).toContain("node");
  });

  it("scaffolds a fragment manifest with a layoutHint skeleton", () => {
    const root = tempRoot();
    const result = runCreateComponent({
      root,
      positional: ["ThrowawayPanel"],
      type: "fragment",
      ci: false,
      warnOnly: false,
      force: false,
    });
    expect(result.status).toBe("created");
    const manifest = readFileSync(
      join(root, "fragments/throwaway-panel/src/manifest.ts"),
      "utf8",
    );
    expect(manifest).toContain(
      'layoutHint: { shape: "panel", minHeight: 120, fills: false }',
    );
    // The skeleton tells the agent to replace the placeholder geometry.
    expect(manifest).toContain("Adjust shape/minHeight/fills");
  });

  it("scaffolds a fragment manifest that satisfies FragmentManifest at compile time", () => {
    const root = tempRoot();
    const result = runCreateComponent({
      root,
      positional: ["TypedPanel"],
      type: "fragment",
      ci: false,
      warnOnly: false,
      force: false,
    });
    expect(result.status).toBe("created");
    const manifest = readFileSync(
      join(root, "fragments/typed-panel/src/manifest.ts"),
      "utf8",
    );
    // H1: new fragments get compile-time checking against the contract type,
    // so a drifted scaffold fails `tsc`, not just the runtime loader parse.
    expect(manifest).toContain(
      'import { type FragmentManifest, loadDefaultBudget } from "@mvp/contracts";',
    );
    expect(manifest).toContain("} satisfies FragmentManifest");
    expect(manifest).toContain('renderStrategy: "dynamic-ssr"');
  });

  it("does not overwrite existing components unless forced and rejects illegal names", () => {
    const root = tempRoot();
    expect(
      runCreateComponent({
        root,
        positional: ["ProductBadge"],
        type: "ui",
        ci: false,
        warnOnly: false,
        force: false,
      }).status,
    ).toBe("created");
    expect(
      runCreateComponent({
        root,
        positional: ["ProductBadge"],
        type: "ui",
        ci: false,
        warnOnly: false,
        force: false,
      }).status,
    ).toBe("failed");
    expect(
      runCreateComponent({
        root,
        positional: ["bad-name"],
        type: "ui",
        ci: false,
        warnOnly: false,
        force: false,
      }).error,
    ).toContain("PascalCase");
  });
});
