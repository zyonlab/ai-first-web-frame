import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCreateComponent } from "./index";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "mvp-create-component-"));
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
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

  it("generates a fragment that runs: host-backed server, real Dockerfile, tests", () => {
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
    const read = (file: string) =>
      readFileSync(join(root, "fragments/promotion-card", file), "utf8");

    // The server is a real service, not a re-export: it mounts the shared
    // fragment host, which owns /health, /ready, /metrics, /manifest,
    // /assets, /budget and POST /render.
    const server = read("src/server.ts");
    expect(server).toContain('from "@mvp/fragment-host"');
    expect(server).toContain("createFragmentServer(");
    expect(server).toContain("startFragmentServer(");

    // The Dockerfile actually builds an image (the old template had no
    // COPY/install/build at all, so it could never produce a runnable one).
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("COPY . .");
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain(
      "pnpm --filter @mvp/fragment-promotion-card... build",
    );
    expect(dockerfile).toMatch(/EXPOSE \d{4}/);

    // package.json carries the deps the generated code imports, plus the
    // start/build/test scripts the lifecycle and image both rely on.
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.name).toBe("@mvp/fragment-promotion-card");
    expect(pkg.dependencies["@mvp/fragment-host"]).toBe("workspace:*");
    expect(pkg.scripts.build).toContain("tsdown src/server.ts");
    expect(pkg.scripts.start).toBe("node dist/server.js");

    // A tsconfig.json is what makes the new unit visible to `pnpm typecheck`
    // (scripts/tsgo-typecheck.mts discovers projects by that file).
    expect(read("tsconfig.json")).toContain("tsconfig.base.json");

    // Fixtures must pass the strict FragmentRenderRequestSchema pass — the old
    // `{ ctx: {} }` placeholder never could.
    const fixtures = read("src/fixtures.ts");
    expect(fixtures).toContain('locale: "en-US"');
    expect(fixtures).toContain('tenant: "default"');

    // Render returns the { statusCode, body } shape the host expects, with a
    // metadata-stamped degraded path.
    const render = read("src/render.ts");
    expect(render).toContain(
      "statusCode: number; body: FragmentRenderResponse",
    );
    expect(render).toContain("fallback: true");
  });

  it("allocates the next free fragment port so the unit runs as scaffolded", () => {
    const root = tempRoot();
    write(
      join(root, "fragments/taken/src/server.ts"),
      "const DEFAULT_PORT = 4201;\n",
    );
    write(
      join(root, "fragments/also-taken/src/server.ts"),
      "const DEFAULT_PORT = 4202;\n",
    );
    runCreateComponent({
      root,
      positional: ["FreePort"],
      type: "fragment",
      ci: false,
      warnOnly: false,
      force: false,
    });
    const server = readFileSync(
      join(root, "fragments/free-port/src/server.ts"),
      "utf8",
    );
    expect(server).toContain("const DEFAULT_PORT = 4203;");
    expect(
      readFileSync(join(root, "fragments/free-port/Dockerfile"), "utf8"),
    ).toContain("EXPOSE 4203");
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
