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

  it("allows a Next page-app server component to import a local client island but not a fragment", () => {
    const root = tempRoot("island");
    write(
      join(root, "apps/page-home/app/Island.tsx"),
      '"use client";\nexport function Island() { return null; }\n',
    );
    write(
      join(root, "apps/page-home/app/page.tsx"),
      'import { Island } from "./Island";\nexport default function Page() { return null; }\n',
    );
    write(
      join(root, "fragments/promo/src/Island.tsx"),
      '"use client";\nexport function Island() { return null; }\n',
    );
    write(
      join(root, "fragments/promo/src/server.ts"),
      'import { Island } from "./Island";\nexport const server = Island;\n',
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    const clientOnly = report.issues.filter(
      (issue) => issue.code === "client-only-dependency-in-server",
    );
    expect(clientOnly).toHaveLength(1);
    expect(clientOnly[0].file).toBe("fragments/promo/src/server.ts");
    rmSync(root, { recursive: true, force: true });
  });

  it("fails a non-allowlisted framework package importing domain/product code", () => {
    const root = tempRoot("layering-fail");
    write(
      join(root, "domains/some-domain/package.json"),
      JSON.stringify({ name: "@mvp/some-domain" }),
    );
    write(
      join(root, "domains/some-domain/src/index.ts"),
      "export const thing = 1;\n",
    );
    write(
      join(root, "packages/some-pkg/src/index.ts"),
      'import { thing } from "@mvp/some-domain";\nexport { thing };\n',
    );
    write(
      join(root, "packages/other-pkg/src/index.ts"),
      'import { relThing } from "../../../domains/some-domain/src/index";\nexport { relThing };\n',
    );
    write(
      join(root, "apps/page-home/package.json"),
      JSON.stringify({ name: "@mvp/page-home" }),
    );
    write(
      join(root, "packages/uses-app/src/index.ts"),
      'import { helper } from "@mvp/page-home";\nexport { helper };\n',
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    const layering = report.issues.filter(
      (issue) => issue.code === "domain-code-in-framework-package",
    );
    expect(
      layering.some((issue) => issue.file === "packages/some-pkg/src/index.ts"),
    ).toBe(true);
    expect(
      layering.some(
        (issue) => issue.file === "packages/other-pkg/src/index.ts",
      ),
    ).toBe(true);
    expect(
      layering.some((issue) => issue.file === "packages/uses-app/src/index.ts"),
    ).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("allowlists the known pre-existing trade-domain leaks in framework packages", () => {
    const root = tempRoot("layering-allowlist");
    write(
      join(root, "domains/trade-chart/package.json"),
      JSON.stringify({ name: "@mvp/trade-chart" }),
    );
    write(
      join(root, "domains/trade-chart/src/index.ts"),
      "export const chart = 1;\n",
    );
    // Mirrors the real repo's remaining known leaks (packages/trade-client and
    // packages/interaction/src/trade were migrated away in Phase P1 and are no
    // longer allowlisted): packages/data's trade source registry, packages/
    // storage's trade prefs, and packages/design-system's trade theme helper.
    // Each imports domain code here to prove the allowlist suppresses the
    // issue without weakening the check for anything else.
    write(
      join(root, "packages/data/src/sources/tradeClient.ts"),
      'import { chart } from "@mvp/trade-chart";\nexport { chart };\n',
    );
    write(
      join(root, "packages/data/src/index.ts"),
      'import { chart } from "@mvp/trade-chart";\nexport { chart };\n',
    );
    write(
      join(root, "packages/storage/src/prefs/watchlist.ts"),
      'import { chart } from "@mvp/trade-chart";\nexport { chart };\n',
    );
    write(
      join(root, "packages/design-system/src/themes.ts"),
      'import { chart } from "@mvp/trade-chart";\nexport { chart };\n',
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    const layering = report.issues.filter(
      (issue) => issue.code === "domain-code-in-framework-package",
    );
    expect(layering).toHaveLength(0);
    rmSync(root, { recursive: true, force: true });
  });
});
