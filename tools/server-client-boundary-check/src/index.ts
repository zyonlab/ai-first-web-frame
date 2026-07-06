import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type CliOptions, parseArgs } from "../../_shared/args";
import { browserGlobals, hasUseClient, parseImports } from "../../_shared/code";
import { findWorkspaceRoot, relativePosix, walkFiles } from "../../_shared/fs";
import {
  exitCodeFor,
  statusFromCounts,
  writeReports,
} from "../../_shared/report";

type BoundaryIssue = {
  code:
    | "server-browser-global"
    | "server-imports-client-module"
    | "large-client-component"
    | "page-use-client";
  severity: "warn" | "fail";
  file: string;
  detail: string;
};

export type BoundaryReport = {
  tool: "server-client-boundary-check";
  status: "pass" | "warn" | "fail";
  checkedFiles: string[];
  issues: BoundaryIssue[];
};

const CLIENT_ONLY_PACKAGES = ["framer-motion", "@react-three/fiber", "gsap"];

export function runBoundaryCheck(
  options: CliOptions = parseArgs(process.argv.slice(2)),
): BoundaryReport {
  const root = options.root ?? findWorkspaceRoot();
  const files = [
    ...walkFiles(join(root, "packages", "ui"), isSourceFile),
    ...walkFiles(join(root, "apps"), isSourceFile),
    ...walkFiles(join(root, "fragments"), isSourceFile),
  ];
  const issues: BoundaryIssue[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const relativeFile = relativePosix(root, file);
    const client = hasUseClient(source);
    if (!client) {
      const globals = browserGlobals(source);
      if (globals.length > 0) {
        issues.push({
          code: "server-browser-global",
          severity: "fail",
          file: relativeFile,
          detail: `server file uses ${globals.join(", ")}`,
        });
      }
      for (const specifier of parseImports(source)) {
        if (isClientOnlyImport(root, file, specifier)) {
          // Next.js App Router server components may mount a local "use client"
          // island; the bundler owns that boundary. Allow local island imports
          // inside the Next page apps only — fastify fragments/shell still fail.
          const isLocalIsland =
            specifier.startsWith(".") && relativeFile.startsWith("apps/page-");
          if (!isLocalIsland) {
            issues.push({
              code: "server-imports-client-module",
              severity: "fail",
              file: relativeFile,
              detail: `server file imports ${specifier}`,
            });
          }
        }
      }
    } else if (
      source.split(/\r?\n/).length > 200 ||
      Buffer.byteLength(source) > 10000
    ) {
      issues.push({
        code: "large-client-component",
        severity: "warn",
        file: relativeFile,
        detail: "client component exceeds size guideline",
      });
    }
    if (client && /(^|\/)(page|layout)\.(tsx|ts|jsx|js)$/.test(relativeFile)) {
      issues.push({
        code: "page-use-client",
        severity: "warn",
        file: relativeFile,
        detail: "page/layout should avoid top-level use client",
      });
    }
  }

  const report: BoundaryReport = {
    tool: "server-client-boundary-check",
    status: statusFromCounts(
      issues.filter((issue) => issue.severity === "fail").length,
      issues.filter((issue) => issue.severity === "warn").length,
    ),
    checkedFiles: files.map((file) => relativePosix(root, file)).sort(),
    issues: issues.sort((a, b) =>
      `${a.severity}:${a.code}:${a.file}`.localeCompare(
        `${b.severity}:${b.code}:${b.file}`,
      ),
    ),
  };

  writeReports(
    root,
    "server-client-boundary-report",
    report,
    renderMarkdown(report),
  );
  return report;
}

function isSourceFile(path: string): boolean {
  return (
    /\.(ts|tsx|js|jsx)$/.test(path) &&
    !/\/\.next\//.test(path) &&
    !/\/dist\//.test(path) &&
    !/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(path)
  );
}

function isClientOnlyImport(
  _root: string,
  file: string,
  specifier: string,
): boolean {
  if (
    CLIENT_ONLY_PACKAGES.some(
      (packageName) =>
        specifier === packageName || specifier.startsWith(`${packageName}/`),
    )
  ) {
    return true;
  }
  if (!specifier.startsWith(".")) {
    return false;
  }
  const base = resolve(dirname(file), specifier);
  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    join(base, "index.tsx"),
    join(base, "index.ts"),
  ];
  return candidates.some(
    (candidate) =>
      existsSync(candidate) &&
      statSync(candidate).isFile() &&
      hasUseClient(readFileSync(candidate, "utf8")),
  );
}

function renderMarkdown(report: BoundaryReport): string {
  const rows = report.issues.map(
    (issue) =>
      `| ${issue.severity} | ${issue.code} | ${issue.file} | ${issue.detail} |`,
  );
  return [
    "# Server Client Boundary Report",
    "",
    `Status: ${report.status}`,
    `Checked files: ${report.checkedFiles.length}`,
    "",
    "| Severity | Code | File | Detail |",
    "| --- | --- | --- | --- |",
    ...(rows.length > 0 ? rows : ["| - | - | - | - |"]),
  ].join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const options = parseArgs(process.argv.slice(2));
  const report = runBoundaryCheck(options);
  process.exitCode = exitCodeFor(report.status, options.ci, options.warnOnly);
}
