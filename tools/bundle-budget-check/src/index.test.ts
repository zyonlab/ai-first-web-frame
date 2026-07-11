import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runBundleBudgetCheck } from "./index";

function tempRoot(name: string): string {
  const root = join(
    tmpdir(),
    `mvp-bundle-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  return root;
}

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

// Unit-budget fixtures are created *inside* this package (not `os.tmpdir()`):
// the loader dynamically `import()`s `budget.ts` files, and under Vitest's
// SSR module runner that resolution is subject to Vite's dev-server
// `fs.allow` restriction, which rejects paths outside the workspace root.
// (Same pattern as `tools/release-tools/src/load-graph.test.ts`.)
const FIXTURE_PARENT = dirname(fileURLToPath(import.meta.url));

describe("bundle-budget-check (legacy root budget.json/stats.json)", () => {
  it("passes when actual sizes are within budget", async () => {
    const root = tempRoot("pass");
    write(
      join(root, "budget.json"),
      JSON.stringify({ component: { jsBytes: 100, cssBytes: 20 } }),
    );
    write(
      join(root, "stats.json"),
      JSON.stringify({ component: { jsBytes: 80, cssBytes: 20 } }),
    );
    const report = await runBundleBudgetCheck({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      scope: "component",
      positional: [],
    });
    expect(report.status).toBe("pass");
    rmSync(root, { recursive: true, force: true });
  });

  it("fails when a budget is exceeded", async () => {
    const root = tempRoot("fail");
    write(
      join(root, "budget.json"),
      JSON.stringify({ page: { jsBytes: 100 } }),
    );
    write(join(root, "stats.json"), JSON.stringify({ page: { jsBytes: 101 } }));
    const report = await runBundleBudgetCheck({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      scope: "page",
      positional: [],
    });
    expect(report.status).toBe("fail");
    expect(report.checks[0]).toMatchObject({
      actual: 101,
      budget: 100,
      status: "fail",
    });
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    "component",
    "fragment",
    "page",
    "shell",
  ])("checks %s scope", async (scope) => {
    const root = tempRoot(scope);
    write(
      join(root, "budget.json"),
      JSON.stringify({ [scope]: { dependencyCount: 4 } }),
    );
    write(
      join(root, "stats.json"),
      JSON.stringify({ [scope]: { dependencyCount: 3 } }),
    );
    const report = await runBundleBudgetCheck({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      scope,
      positional: [],
    });
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0].scope).toBe(scope);
    rmSync(root, { recursive: true, force: true });
  });

  it("writes actual budget and status fields to stable reports", async () => {
    const root = tempRoot("report");
    write(
      join(root, "budget.json"),
      JSON.stringify({ shell: { jsBytes: 100 } }),
    );
    write(join(root, "stats.json"), JSON.stringify({ shell: { jsBytes: 90 } }));
    await runBundleBudgetCheck({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      scope: "shell",
      positional: [],
    });
    const json = JSON.parse(
      readFileSync(join(root, "reports/bundle-report.json"), "utf8"),
    );
    expect(Object.keys(json)).toEqual([
      "tool",
      "status",
      "checks",
      "unmeasured",
      "notes",
    ]);
    expect(json.checks[0]).toMatchObject({
      actual: 90,
      budget: 100,
      status: "pass",
    });
    expect(
      readFileSync(join(root, "reports/bundle-report.md"), "utf8"),
    ).toContain("Bundle Budget Report");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("bundle-budget-check (per-unit budget.ts gates)", () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function run(fixtureRoot: string) {
    return runBundleBudgetCheck({
      ci: true,
      warnOnly: false,
      force: false,
      root: fixtureRoot,
      positional: [],
    });
  }

  it("FAILS the audit when a fragment's bundled client JS exceeds its declared jsBytes ceiling", async () => {
    root = mkdtempSync(join(FIXTURE_PARENT, ".bundle-fixture-fat-"));
    write(
      join(root, "fragments", "fat-fragment", "src", "budget.ts"),
      'export const fatFragmentBudget = { scope: "fragment", name: "fat-fragment", jsBytes: 16 } as const;\n',
    );
    write(
      join(root, "fragments", "fat-fragment", "src", "client.ts"),
      `export const payload = ${JSON.stringify("x".repeat(512))};\nconsole.log(payload);\n`,
    );
    const report = await run(root);
    expect(report.status).toBe("fail");
    const row = report.checks.find((check) => check.unit === "fat-fragment");
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      scope: "fragment",
      metric: "jsBytes",
      budget: 16,
      status: "fail",
    });
    expect(row?.actual).toBeGreaterThan(16);
    expect(row?.measurement).toContain("client.ts");
  });

  it("passes a fragment within its ceiling and reports ssr-only fragments as zero", async () => {
    root = mkdtempSync(join(FIXTURE_PARENT, ".bundle-fixture-ok-"));
    write(
      join(root, "fragments", "slim", "src", "budget.ts"),
      'export const slimBudget = { scope: "fragment", name: "slim", jsBytes: 30000 } as const;\n',
    );
    write(
      join(root, "fragments", "slim", "src", "island.tsx"),
      'export function mount(): string {\n  return "ok";\n}\n',
    );
    write(
      join(root, "fragments", "ssr-only", "src", "budget.ts"),
      'export const ssrOnlyBudget = { scope: "fragment", name: "ssr-only", jsBytes: 2000 } as const;\n',
    );
    const report = await run(root);
    expect(report.status).toBe("pass");
    const slim = report.checks.find((check) => check.unit === "slim");
    expect(slim?.status).toBe("pass");
    expect(slim?.actual).toBeGreaterThan(0);
    const ssrOnly = report.checks.find((check) => check.unit === "ssr-only");
    expect(ssrOnly).toMatchObject({ actual: 0, status: "pass" });
    expect(ssrOnly?.measurement).toContain("no client entry");
  });

  it("fails loudly (not silently passes) when a page with a jsBytes budget has no .next build", async () => {
    root = mkdtempSync(join(FIXTURE_PARENT, ".bundle-fixture-unbuilt-"));
    write(
      join(root, "apps", "page-x", "src", "budget.ts"),
      'export const xPageBudget = { scope: "page", name: "page-x", jsBytes: 180000 } as const;\n',
    );
    const report = await run(root);
    expect(report.status).toBe("fail");
    const row = report.checks.find((check) => check.unit === "page-x");
    expect(row).toMatchObject({
      scope: "page",
      metric: "jsBytes",
      actual: -1,
      status: "fail",
    });
    expect(row?.note).toContain("pnpm build");
  });

  it("measures a page's gzipped first-load JS from the .next manifests and gates it", async () => {
    root = mkdtempSync(join(FIXTURE_PARENT, ".bundle-fixture-page-"));
    const appDir = join(root, "apps", "page-y");
    write(
      join(appDir, "src", "budget.ts"),
      'export const yPageBudget = { scope: "page", name: "page-y", jsBytes: 10, cssBytes: 50000 } as const;\n',
    );
    write(
      join(appDir, ".next", "build-manifest.json"),
      JSON.stringify({ rootMainFiles: ["static/chunks/main-app.js"] }),
    );
    write(
      join(appDir, ".next", "app-build-manifest.json"),
      JSON.stringify({
        pages: {
          "/page": ["static/chunks/main-app.js", "static/chunks/app/page.js"],
          "/health/route": ["static/chunks/ignored-route.js"],
        },
      }),
    );
    write(
      join(appDir, ".next", "static", "chunks", "main-app.js"),
      `console.log(${JSON.stringify("y".repeat(2048))});\n`,
    );
    write(
      join(appDir, ".next", "static", "chunks", "app", "page.js"),
      "console.log(1);\n",
    );
    const report = await run(root);
    const row = report.checks.find(
      (check) => check.unit === "page-y" && check.metric === "jsBytes",
    );
    expect(row?.status).toBe("fail");
    expect(row?.actual).toBeGreaterThan(10);
    expect(report.status).toBe("fail");
    // No extracted CSS asset: cssBytes must be reported as unmeasured, not
    // silently passed.
    expect(report.unmeasured).toContainEqual(
      expect.objectContaining({ unit: "page-y", metric: "cssBytes" }),
    );
  });
});
