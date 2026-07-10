import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type CliOptions, parseArgs } from "../../_shared/args";
import { browserGlobals, hasUseClient, parseImports } from "../../_shared/code";
import {
  findWorkspaceRoot,
  readJson,
  relativePosix,
  walkFiles,
} from "../../_shared/fs";
import {
  exitCodeFor,
  statusFromCounts,
  writeReports,
} from "../../_shared/report";

type AuditIssue = {
  code:
    | "duplicated-package-version"
    | "forbidden-package"
    | "large-package"
    | "cross-page-import"
    | "fragment-importing-page-code"
    | "page-importing-another-page"
    | "raw-fetch-in-business-code"
    | "server-safe-browser-global"
    | "client-only-dependency-in-server"
    | "domain-code-in-framework-package";
  severity: "warn" | "fail";
  file?: string;
  packageName?: string;
  detail: string;
};

export type DependencyReport = {
  tool: "dependency-audit";
  status: "pass" | "warn" | "fail";
  issues: AuditIssue[];
};

const DEFAULT_CLIENT_ONLY = ["framer-motion", "@react-three/fiber", "gsap"];
const DEFAULT_LARGE_PACKAGES: Record<string, number> = {
  lodash: 70000,
  moment: 65000,
};
// Framework packages whose whole purpose is to wrap browser APIs. The
// server-safe browser-global guard is skipped for files under these prefixes;
// they gate real access behind runtime capability checks / dependency injection.
// `islands` is the generic client-side island runtime (React hydration) —
// window/document are its job, not accidental leakage.
const DEFAULT_BROWSER_CAPABLE = ["packages/storage/", "packages/islands/"];

export function runDependencyAudit(
  options: CliOptions = parseArgs(process.argv.slice(2)),
): DependencyReport {
  const root = options.root ?? findWorkspaceRoot();
  const config = readConfig(root);
  const issues: AuditIssue[] = [];
  issues.push(...auditPackageVersions(root, config));
  issues.push(...auditSourceImports(root, config));
  issues.push(...auditPackageLayering(root));

  const report: DependencyReport = {
    tool: "dependency-audit",
    status: statusFromCounts(
      issues.filter((issue) => issue.severity === "fail").length,
      issues.filter((issue) => issue.severity === "warn").length,
    ),
    issues: issues.sort((a, b) =>
      `${a.code}:${a.file ?? ""}:${a.packageName ?? ""}`.localeCompare(
        `${b.code}:${b.file ?? ""}:${b.packageName ?? ""}`,
      ),
    ),
  };

  writeReports(root, "dependency-report", report, renderMarkdown(report));
  return report;
}

function readConfig(root: string): {
  forbiddenPackages: string[];
  clientOnlyPackages: string[];
  browserCapablePackages: string[];
  largePackages: Record<string, number>;
} {
  const path = join(root, "dependency-audit.json");
  if (!existsSync(path)) {
    return {
      forbiddenPackages: [],
      clientOnlyPackages: DEFAULT_CLIENT_ONLY,
      browserCapablePackages: DEFAULT_BROWSER_CAPABLE,
      largePackages: DEFAULT_LARGE_PACKAGES,
    };
  }
  const value = readJson<Record<string, unknown>>(path);
  return {
    forbiddenPackages: Array.isArray(value.forbiddenPackages)
      ? value.forbiddenPackages.map(String)
      : [],
    clientOnlyPackages: Array.isArray(value.clientOnlyPackages)
      ? value.clientOnlyPackages.map(String)
      : DEFAULT_CLIENT_ONLY,
    browserCapablePackages: Array.isArray(value.browserCapablePackages)
      ? value.browserCapablePackages.map(String)
      : DEFAULT_BROWSER_CAPABLE,
    largePackages:
      typeof value.largePackages === "object" && value.largePackages
        ? (value.largePackages as Record<string, number>)
        : DEFAULT_LARGE_PACKAGES,
  };
}

function auditPackageVersions(
  root: string,
  config: ReturnType<typeof readConfig>,
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const versions = new Map<string, Map<string, string[]>>();
  const packageJsonFiles = [
    join(root, "package.json"),
    ...walkFiles(join(root, "apps"), (path) => path.endsWith("package.json")),
    ...walkFiles(join(root, "fragments"), (path) =>
      path.endsWith("package.json"),
    ),
    ...walkFiles(join(root, "packages"), (path) =>
      path.endsWith("package.json"),
    ),
    ...walkFiles(join(root, "tools"), (path) => path.endsWith("package.json")),
  ].filter((path) => existsSync(path));

  for (const file of packageJsonFiles) {
    const json =
      readJson<Record<string, Record<string, string> | undefined>>(file);
    const dependencies = {
      ...json.dependencies,
      ...json.devDependencies,
      ...json.peerDependencies,
    };
    for (const [packageName, version] of Object.entries(dependencies)) {
      if (!versions.has(packageName)) {
        versions.set(packageName, new Map());
      }
      const byVersion =
        versions.get(packageName) ?? new Map<string, string[]>();
      versions.set(packageName, byVersion);
      byVersion.set(version, [
        ...(byVersion.get(version) ?? []),
        relativePosix(root, file),
      ]);
      if (config.forbiddenPackages.includes(packageName)) {
        issues.push({
          code: "forbidden-package",
          severity: "fail",
          file: relativePosix(root, file),
          packageName,
          detail: `${packageName} is forbidden`,
        });
      }
      if (config.largePackages[packageName]) {
        issues.push({
          code: "large-package",
          severity: "warn",
          file: relativePosix(root, file),
          packageName,
          detail: `${packageName} is marked large (${config.largePackages[packageName]} bytes)`,
        });
      }
    }
  }

  for (const [packageName, byVersion] of versions) {
    if (byVersion.size > 1) {
      issues.push({
        code: "duplicated-package-version",
        severity: "fail",
        packageName,
        detail: [...byVersion.entries()]
          .map(([version, files]) => `${version}: ${files.join(", ")}`)
          .join("; "),
      });
    }
  }
  return issues;
}

function auditSourceImports(
  root: string,
  config: ReturnType<typeof readConfig>,
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const files = [
    ...walkFiles(join(root, "apps"), isSourceFile),
    ...walkFiles(join(root, "fragments"), isSourceFile),
    ...walkFiles(join(root, "packages"), isSourceFile),
  ];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const relativeFile = relativePosix(root, file);
    const imports = parseImports(source);
    const pageName = pageForPath(relativeFile);
    for (const specifier of imports) {
      const target = normalizeImportTarget(root, file, specifier);
      const targetPage = pageForPath(target);
      if (pageName && targetPage && pageName !== targetPage) {
        issues.push({
          code: "page-importing-another-page",
          severity: "fail",
          file: relativeFile,
          detail: `${pageName} imports ${targetPage}`,
        });
        issues.push({
          code: "cross-page-import",
          severity: "fail",
          file: relativeFile,
          detail: `${relativeFile} imports ${specifier}`,
        });
      }
      if (
        relativeFile.startsWith("fragments/") &&
        (target.startsWith("apps/page-") || specifier.startsWith("@mvp/page-"))
      ) {
        issues.push({
          code: "fragment-importing-page-code",
          severity: "fail",
          file: relativeFile,
          detail: `fragment imports ${specifier}`,
        });
      }
      if (
        !hasUseClient(source) &&
        isClientOnlyImport(root, file, specifier, config.clientOnlyPackages)
      ) {
        // Next.js App Router server components may import and render a local
        // "use client" component — that is the island boundary, and the bundler
        // serializes props across it. Only allow this for local modules inside
        // the Next page apps; fragments/shell (fastify) and packages still fail.
        const isLocalIsland =
          specifier.startsWith(".") && relativeFile.startsWith("apps/page-");
        if (!isLocalIsland) {
          issues.push({
            code: "client-only-dependency-in-server",
            severity: "fail",
            file: relativeFile,
            detail: `server file imports client-only module ${specifier}`,
          });
        }
      }
    }
    const browserCapable = config.browserCapablePackages.some((prefix) =>
      relativeFile.startsWith(prefix),
    );
    if (
      relativeFile.startsWith("packages/") &&
      !hasUseClient(source) &&
      !browserCapable
    ) {
      const globals = browserGlobals(source);
      if (globals.length > 0) {
        issues.push({
          code: "server-safe-browser-global",
          severity: "fail",
          file: relativeFile,
          detail: `server-safe package uses ${globals.join(", ")}`,
        });
      }
    }
    if (isBusinessCodeFile(relativeFile) && hasRawFetch(source)) {
      issues.push({
        code: "raw-fetch-in-business-code",
        severity: "fail",
        file: relativeFile,
        detail:
          "business code must use @mvp/request or @mvp/data instead of raw fetch",
      });
    }
  }
  return issues;
}

// Layering audit (docs/ARCHITECTURE_REFACTOR_PLAN.md §2.1, goal B3): the
// framework layer (`packages/**`) must never import "down" into the domain
// layer (`domains/**`) or the product layer (`apps/**`, `fragments/**`).
// Imports only point downward: apps/fragments -> domains -> packages.
//
// This is scaffolding added ahead of the Phase P1 re-layering migration (see
// docs/ARCHITECTURE_REFACTOR_PLAN.md §8, Phase P1, and the P1-prep task that
// added this check). The Phase 1 migration (§2.2 Move A: `packages/trade-client`
// split into `@mvp/store` / `@mvp/islands` / `domains/trade-chart`; Move B:
// `packages/interaction/src/trade/*` moved to `domains/trade-contracts`) has
// landed, so those two leaks are gone — removed from this list so the
// allowlist doesn't silently mask a regression. The remaining entries (the
// trade source registry appended to `packages/data/src/sources/tradeClient.ts`
// / `packages/data/src/index.ts`, the trade prefs under
// `packages/storage/src/prefs/*`, and `createTradeAliasVariables` in
// `packages/design-system/src/themes.ts`) are still-pending moves (§2.2 table
// rows for `domains/trade-data`, `domains/trade-prefs`, `domains/trade-theme`)
// left for a later phase. Do NOT add new entries here for anything other than
// these already-known leaks; any new violation outside this list must fail.
const KNOWN_LEAKS = [
  "packages/data/src/sources/tradeClient.ts",
  "packages/data/src/index.ts",
  "packages/storage/src/prefs/",
  "packages/design-system/src/themes.ts",
];

function isKnownLeak(relativeFile: string): boolean {
  return KNOWN_LEAKS.some((prefix) => relativeFile.startsWith(prefix));
}

// Reads the `name` field of every immediate child package under `<root>/<dir>`
// (e.g. all `domains/*` or `apps/*` package.json files) so layering violations
// can be detected both by relative-path target and by published package name.
function collectPackageNames(root: string, dir: string): string[] {
  const base = join(root, dir);
  if (!existsSync(base)) {
    return [];
  }
  const names: string[] = [];
  for (const entry of readdirSync(base)) {
    const packageJsonPath = join(base, entry, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    const packageJson = readJson<{ name?: string }>(packageJsonPath);
    if (packageJson.name) names.push(packageJson.name);
  }
  return names;
}

type LayeringTarget = "domains" | "apps" | "fragments";

function classifyLayeringTarget(
  root: string,
  file: string,
  specifier: string,
  packageNamesByLayer: Record<LayeringTarget, string[]>,
): LayeringTarget | undefined {
  if (specifier.startsWith(".")) {
    const target = relativePosix(root, resolve(dirname(file), specifier));
    if (target.startsWith("domains/")) return "domains";
    if (target.startsWith("apps/")) return "apps";
    if (target.startsWith("fragments/")) return "fragments";
    return undefined;
  }
  for (const layer of ["domains", "apps", "fragments"] as const) {
    if (packageNamesByLayer[layer].includes(specifier)) return layer;
  }
  return undefined;
}

function auditPackageLayering(root: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const packageNamesByLayer: Record<LayeringTarget, string[]> = {
    domains: collectPackageNames(root, "domains"),
    apps: collectPackageNames(root, "apps"),
    fragments: collectPackageNames(root, "fragments"),
  };
  const files = walkFiles(join(root, "packages"), isSourceFile).filter((file) =>
    relativePosix(root, file).includes("/src/"),
  );

  for (const file of files) {
    const relativeFile = relativePosix(root, file);
    if (isKnownLeak(relativeFile)) continue;
    const source = readFileSync(file, "utf8");
    for (const specifier of parseImports(source)) {
      const target = classifyLayeringTarget(
        root,
        file,
        specifier,
        packageNamesByLayer,
      );
      if (target) {
        issues.push({
          code: "domain-code-in-framework-package",
          severity: "fail",
          file: relativeFile,
          detail: `packages/** must not import ${target} code (imports "${specifier}")`,
        });
      }
    }
  }
  return issues;
}

function isSourceFile(path: string): boolean {
  return (
    /\.(ts|tsx|js|jsx)$/.test(path) &&
    !/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(path)
  );
}

function pageForPath(path: string): string | undefined {
  return (
    /^apps\/(page-[^/]+)/.exec(path)?.[1] ??
    /^@mvp\/(page-[^/]+)/.exec(path)?.[1]
  );
}

function isBusinessCodeFile(path: string): boolean {
  return (
    /^apps\/page-[^/]+\/(app|src)\//.test(path) ||
    /^fragments\/[^/]+\/src\//.test(path)
  );
}

function hasRawFetch(source: string): boolean {
  return /\bfetch\s*\(/.test(source);
}

function normalizeImportTarget(
  root: string,
  file: string,
  specifier: string,
): string {
  if (specifier.startsWith(".")) {
    return relativePosix(root, resolve(dirname(file), specifier));
  }
  if (specifier.startsWith("@mvp/page-")) {
    return specifier;
  }
  return specifier;
}

function isClientOnlyImport(
  _root: string,
  file: string,
  specifier: string,
  clientOnlyPackages: string[],
): boolean {
  if (
    clientOnlyPackages.some(
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
    join(base, "index.tsx"),
    join(base, "index.ts"),
  ];
  for (const candidate of candidates) {
    if (
      existsSync(candidate) &&
      statSync(candidate).isFile() &&
      hasUseClient(readFileSync(candidate, "utf8"))
    ) {
      return true;
    }
  }
  return false;
}

function renderMarkdown(report: DependencyReport): string {
  const rows = report.issues.map(
    (issue) =>
      `| ${issue.severity} | ${issue.code} | ${issue.file ?? "-"} | ${issue.packageName ?? "-"} | ${issue.detail} |`,
  );
  return [
    "# Dependency Audit Report",
    "",
    `Status: ${report.status}`,
    "",
    "| Severity | Code | File | Package | Detail |",
    "| --- | --- | --- | --- | --- |",
    ...(rows.length > 0 ? rows : ["| - | - | - | - | - |"]),
  ].join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const options = parseArgs(process.argv.slice(2));
  const report = runDependencyAudit(options);
  process.exitCode = exitCodeFor(report.status, options.ci, options.warnOnly);
}
