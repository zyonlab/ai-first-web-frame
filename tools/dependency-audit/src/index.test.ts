import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDependencyAudit } from "./index";

function tempRoot(name: string): string {
  const root = join(
    tmpdir(),
    `mvp-deps-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  return root;
}

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

describe("dependency-audit", () => {
  it("detects duplicated dependency versions and forbidden dependency", () => {
    const root = tempRoot("packages");
    write(
      join(root, "dependency-audit.json"),
      JSON.stringify({ forbiddenPackages: ["left-pad"] }),
    );
    write(
      join(root, "package.json"),
      JSON.stringify({
        dependencies: { react: "18.3.1", "left-pad": "1.3.0" },
      }),
    );
    write(
      join(root, "packages/ui/package.json"),
      JSON.stringify({ dependencies: { react: "17.0.2" } }),
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(
      report.issues.some(
        (issue) =>
          issue.code === "duplicated-package-version" &&
          issue.packageName === "react",
      ),
    ).toBe(true);
    expect(
      report.issues.some(
        (issue) =>
          issue.code === "forbidden-package" &&
          issue.packageName === "left-pad",
      ),
    ).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("detects page-to-page and fragment-to-page imports", () => {
    const root = tempRoot("imports");
    write(
      join(root, "apps/page-home/src/home.ts"),
      'import "@mvp/page-product";\n',
    );
    write(
      join(root, "fragments/promo/src/render.tsx"),
      'import "@mvp/page-home";\n',
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(
      report.issues.some(
        (issue) => issue.code === "page-importing-another-page",
      ),
    ).toBe(true);
    expect(
      report.issues.some(
        (issue) => issue.code === "fragment-importing-page-code",
      ),
    ).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("detects browser globals in server-safe packages and client-only leakage", () => {
    const root = tempRoot("server");
    write(
      join(root, "packages/ui/src/client.tsx"),
      '"use client";\nexport const Client = () => null;\n',
    );
    write(
      join(root, "packages/ui/src/server.tsx"),
      'import { Client } from "./client";\nexport const width = window.innerWidth;\n',
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(
      report.issues.some(
        (issue) => issue.code === "server-safe-browser-global",
      ),
    ).toBe(true);
    expect(
      report.issues.some(
        (issue) => issue.code === "client-only-dependency-in-server",
      ),
    ).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("detects raw fetch in page and fragment business code", () => {
    const root = tempRoot("raw-fetch");
    write(
      join(root, "apps/page-home/src/data.ts"),
      'export async function load() { return fetch("https://api.example.test"); }\n',
    );
    write(
      join(root, "fragments/promo/src/render.ts"),
      'export async function render() { return fetch("https://api.example.test"); }\n',
    );
    write(
      join(root, "apps/shell-gateway/src/server.ts"),
      'export async function proxy() { return fetch("http://page-home:4101"); }\n',
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(
      report.issues.filter(
        (issue) => issue.code === "raw-fetch-in-business-code",
      ),
    ).toHaveLength(2);
    rmSync(root, { recursive: true, force: true });
  });

  it("writes a stable report shape", () => {
    const root = tempRoot("report");
    write(join(root, "package.json"), JSON.stringify({ dependencies: {} }));
    runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    const json = JSON.parse(
      readFileSync(join(root, "reports/dependency-report.json"), "utf8"),
    );
    expect(Object.keys(json)).toEqual(["tool", "status", "issues"]);
    expect(
      readFileSync(join(root, "reports/dependency-report.md"), "utf8"),
    ).toContain("Dependency Audit Report");
    rmSync(root, { recursive: true, force: true });
  });
});
