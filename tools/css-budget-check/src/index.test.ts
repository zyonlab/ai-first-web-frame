import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCssBudgetCheck } from "./index";

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
      "findings",
    ]);
    expect(readFileSync(join(root, "reports/css-report.md"), "utf8")).toContain(
      "CSS Budget Report",
    );
    rmSync(root, { recursive: true, force: true });
  });
});
