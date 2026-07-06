import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
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

describe("bundle-budget-check", () => {
  it("passes when actual sizes are within budget", () => {
    const root = tempRoot("pass");
    write(
      join(root, "budget.json"),
      JSON.stringify({ component: { jsBytes: 100, cssBytes: 20 } }),
    );
    write(
      join(root, "stats.json"),
      JSON.stringify({ component: { jsBytes: 80, cssBytes: 20 } }),
    );
    const report = runBundleBudgetCheck({
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

  it("fails when a budget is exceeded", () => {
    const root = tempRoot("fail");
    write(
      join(root, "budget.json"),
      JSON.stringify({ page: { jsBytes: 100 } }),
    );
    write(join(root, "stats.json"), JSON.stringify({ page: { jsBytes: 101 } }));
    const report = runBundleBudgetCheck({
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
  ])("checks %s scope", (scope) => {
    const root = tempRoot(scope);
    write(
      join(root, "budget.json"),
      JSON.stringify({ [scope]: { dependencyCount: 4 } }),
    );
    write(
      join(root, "stats.json"),
      JSON.stringify({ [scope]: { dependencyCount: 3 } }),
    );
    const report = runBundleBudgetCheck({
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

  it("writes actual budget and status fields to stable reports", () => {
    const root = tempRoot("report");
    write(
      join(root, "budget.json"),
      JSON.stringify({ shell: { jsBytes: 100 } }),
    );
    write(join(root, "stats.json"), JSON.stringify({ shell: { jsBytes: 90 } }));
    runBundleBudgetCheck({
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
    expect(Object.keys(json)).toEqual(["tool", "status", "checks"]);
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
