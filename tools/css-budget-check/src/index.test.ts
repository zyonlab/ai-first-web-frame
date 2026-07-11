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
import { runCssBudgetCheck } from "./index";

// Per-unit fixtures live inside this package (not `os.tmpdir()`): the budget
// loader dynamically `import()`s `budget.ts` files, and under Vitest's SSR
// module runner that resolution is subject to Vite's `fs.allow` restriction.
// (Same pattern as `tools/release-tools/src/load-graph.test.ts`.)
const FIXTURE_PARENT = dirname(fileURLToPath(import.meta.url));

function tempRoot(name: string): string {
  const root = join(
    tmpdir(),
    `mvp-css-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  return root;
}

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

describe("css-budget-check", () => {
  it("fails when CSS budget is exceeded", async () => {
    const root = tempRoot("fail");
    write(join(root, "budget.json"), JSON.stringify({ totalCssBytes: 5 }));
    write(
      join(root, "packages/ui/src/Card/Card.module.css"),
      ".card { color: red; padding: 12px; }\n",
    );
    const report = await runCssBudgetCheck({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(report.status).toBe("fail");
    rmSync(root, { recursive: true, force: true });
  });

  it("passes when CSS budget is not exceeded", async () => {
    const root = tempRoot("pass");
    write(join(root, "budget.json"), JSON.stringify({ totalCssBytes: 100 }));
    write(
      join(root, "packages/ui/src/Card/Card.module.css"),
      ".card { color: red; }\n",
    );
    const report = await runCssBudgetCheck({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(report.status).toBe("pass");
    rmSync(root, { recursive: true, force: true });
  });

  it("detects duplicated rules global selectors and important usage", async () => {
    const root = tempRoot("findings");
    write(
      join(root, "budget.json"),
      JSON.stringify({
        duplicatedRules: 0,
        globalSelectors: 0,
        importantCount: 0,
      }),
    );
    write(
      join(root, "packages/ui/src/Card/Card.module.css"),
      "body { margin: 0; }\n.card { color: red !important; }\n.card { color: red !important; }\n",
    );
    const report = await runCssBudgetCheck({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(report.metrics.duplicatedRules).toBe(1);
    expect(report.metrics.globalSelectors).toBe(1);
    expect(report.metrics.importantCount).toBe(2);
    expect(report.status).toBe("fail");
    rmSync(root, { recursive: true, force: true });
  });

  it("writes a stable report shape", async () => {
    const root = tempRoot("report");
    write(join(root, "budget.json"), JSON.stringify({ totalCssBytes: 100 }));
    write(
      join(root, "packages/ui/src/Card/Card.module.css"),
      ".card { color: red; }\n",
    );
    await runCssBudgetCheck({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    const json = JSON.parse(
      readFileSync(join(root, "reports/css-report.json"), "utf8"),
    );
    expect(Object.keys(json)).toEqual([
      "tool",
      "status",
      "metrics",
      "budget",
      "checks",
      "findings",
    ]);
    expect(readFileSync(join(root, "reports/css-report.md"), "utf8")).toContain(
      "CSS Budget Report",
    );
    rmSync(root, { recursive: true, force: true });
  });

  describe("per-unit cssBytes gates (from src/budget.ts)", () => {
    let root: string | undefined;

    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
      root = undefined;
    });

    it("FAILS the audit when a fragment's minified CSS exceeds its declared cssBytes ceiling", async () => {
      root = mkdtempSync(join(FIXTURE_PARENT, ".css-fixture-fat-"));
      writeFileSync(join(root, "budget.json"), "{}");
      mkdirSync(join(root, "fragments", "fat", "src"), { recursive: true });
      mkdirSync(join(root, "fragments", "fat", "assets"), { recursive: true });
      writeFileSync(
        join(root, "fragments", "fat", "src", "budget.ts"),
        'export const fatBudget = { scope: "fragment", name: "fat", cssBytes: 10 } as const;\n',
      );
      writeFileSync(
        join(root, "fragments", "fat", "assets", "fat.css"),
        ".fat { color: red; padding: 12px; margin: 4px; border: 1px solid blue; }\n",
      );
      const report = await runCssBudgetCheck({
        ci: true,
        warnOnly: false,
        force: false,
        root,
        positional: [],
      });
      expect(report.status).toBe("fail");
      const row = report.checks.find((check) => check.unit === "fat");
      expect(row).toMatchObject({
        scope: "fragment",
        metric: "cssBytes",
        budget: 10,
        status: "fail",
      });
      expect(row?.actual).toBeGreaterThan(10);
    });

    it("passes a fragment within its ceiling and reports css-less units explicitly", async () => {
      root = mkdtempSync(join(FIXTURE_PARENT, ".css-fixture-ok-"));
      mkdirSync(join(root, "fragments", "slim", "assets"), {
        recursive: true,
      });
      mkdirSync(join(root, "fragments", "slim", "src"), { recursive: true });
      writeFileSync(
        join(root, "fragments", "slim", "src", "budget.ts"),
        'export const slimBudget = { scope: "fragment", name: "slim", cssBytes: 10000 } as const;\n',
      );
      writeFileSync(
        join(root, "fragments", "slim", "assets", "slim.css"),
        ".slim { color: red; }\n",
      );
      mkdirSync(join(root, "fragments", "bare", "src"), { recursive: true });
      writeFileSync(
        join(root, "fragments", "bare", "src", "budget.ts"),
        'export const bareBudget = { scope: "fragment", name: "bare", cssBytes: 10000 } as const;\n',
      );
      const report = await runCssBudgetCheck({
        ci: true,
        warnOnly: false,
        force: false,
        root,
        positional: [],
      });
      expect(report.status).toBe("pass");
      const slim = report.checks.find((check) => check.unit === "slim");
      expect(slim?.status).toBe("pass");
      expect(slim?.actual).toBeGreaterThan(0);
      const bare = report.checks.find((check) => check.unit === "bare");
      expect(bare).toMatchObject({ actual: 0, status: "pass" });
      expect(bare?.note).toContain("not counted");
    });
  });
});
