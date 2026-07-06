import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runBoundaryCheck } from "./index";

function tempRoot(name: string): string {
  const root = join(
    tmpdir(),
    `mvp-boundary-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  return root;
}

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

describe("server-client-boundary-check", () => {
  it("fails when a server-safe file accesses window", () => {
    const root = tempRoot("server");
    write(
      join(root, "packages/ui/src/Unsafe.tsx"),
      "export const width = window.innerWidth;\n",
    );
    const report = runBoundaryCheck({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(report.status).toBe("fail");
    expect(report.issues[0].code).toBe("server-browser-global");
    rmSync(root, { recursive: true, force: true });
  });

  it("allows client files to access window", () => {
    const root = tempRoot("client");
    write(
      join(root, "packages/ui/src/Client.tsx"),
      '"use client";\nexport const width = window.innerWidth;\n',
    );
    const report = runBoundaryCheck({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(report.status).toBe("pass");
    rmSync(root, { recursive: true, force: true });
  });

  it("warns when page is marked use client and fails server import of client module", () => {
    const root = tempRoot("page");
    write(
      join(root, "apps/page-home/src/page.tsx"),
      '"use client";\nexport default function Page() { return null; }\n',
    );
    write(
      join(root, "packages/ui/src/Client.tsx"),
      '"use client";\nexport function Client() { return null; }\n',
    );
    write(
      join(root, "packages/ui/src/Server.tsx"),
      'import { Client } from "./Client";\nexport function Server() { return <Client />; }\n',
    );
    const report = runBoundaryCheck({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(
      report.issues.some(
        (issue) =>
          issue.code === "page-use-client" && issue.severity === "warn",
      ),
    ).toBe(true);
    expect(
      report.issues.some(
        (issue) =>
          issue.code === "server-imports-client-module" &&
          issue.severity === "fail",
      ),
    ).toBe(true);
    expect(report.status).toBe("fail");
    rmSync(root, { recursive: true, force: true });
  });

  it("writes a stable report shape", () => {
    const root = tempRoot("report");
    write(
      join(root, "packages/ui/src/Safe.tsx"),
      "export function Safe() { return null; }\n",
    );
    runBoundaryCheck({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    const json = JSON.parse(
      readFileSync(
        join(root, "reports/server-client-boundary-report.json"),
        "utf8",
      ),
    );
    expect(Object.keys(json)).toEqual([
      "tool",
      "status",
      "checkedFiles",
      "issues",
    ]);
    expect(
      readFileSync(
        join(root, "reports/server-client-boundary-report.md"),
        "utf8",
      ),
    ).toContain("Server Client Boundary Report");
    rmSync(root, { recursive: true, force: true });
  });
});
