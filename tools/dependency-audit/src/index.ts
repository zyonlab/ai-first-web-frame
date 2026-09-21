import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type CliOptions, parseArgs } from "../../_shared/args";
import {
  browserGlobals,
  hasUseClient,
  parseImports,
  stripCommentsAndStrings,
} from "../../_shared/code";
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
    | "domain-code-in-framework-package"
    | "island-bus-without-escape-hatch"
    // The gateway legitimately uses raw fetch (dynamic upstream origins), but a
    // raw fetch with no cancellation is a hang on the single entry point.
    | "fetch-without-timeout"
    // A fragment that hand-rolls its own HTTP server instead of delegating to
    // @mvp/fragment-host — the duplication this repo just finished removing.
    | "fragment-server-not-hosted"
    // Declarative layering (tags + depConstraints); replaces the hard-coded
    // `domain-code-in-framework-package` check when a config supplies them.
    | "layer-constraint-violation"
    // A deployable unit importing a workspace package it does not declare.
    // Invisible to a whole-repo `pnpm build` (which builds everything anyway)
    // and fatal to `pnpm --filter <unit>... build`, which is how the unit is
    // built in its own Dockerfile.
    | "undeclared-workspace-import";
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
  // Declarative layering when the repo ships depConstraints; the original
  // hard-coded three-layer check remains the behaviour for a config-less root
  // (which is what the unit tests construct).
  issues.push(
    ...(config.depConstraints.length > 0
      ? auditDeclarativeLayering(root, config.tags, config.depConstraints)
      : auditPackageLayering(root)),
  );
  issues.push(...auditIslandBusEscapeHatch(root));
  issues.push(...auditFragmentServerHost(root));
  issues.push(...auditUndeclaredWorkspaceImports(root));

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

/**
 * Declarative layering, modelled on `@nx/enforce-module-boundaries`.
 *
 * The layering rule used to be three hard-coded directory names inside
 * `auditPackageLayering`, so adding a layer (or a second domain group) meant
 * editing this TypeScript. Nx expresses the same idea as data: units carry
 * `tags`, and `depConstraints` say which tags a tagged unit may depend on.
 *
 * `tags` keys are `<group>/<name>` globs (`packages/*`, `domains/trade-*`);
 * `onlyDependOnLibsWithTags` accepts `*` to mean "anything". A unit with no tag
 * is unconstrained, which is why `tools/*` needs no entry.
 */
export type DepConstraint = {
  sourceTag: string;
  onlyDependOnLibsWithTags: string[];
};

function readConfig(root: string): {
  forbiddenPackages: string[];
  clientOnlyPackages: string[];
  browserCapablePackages: string[];
  largePackages: Record<string, number>;
  tags: Record<string, string[]>;
  depConstraints: DepConstraint[];
} {
  const path = join(root, "dependency-audit.json");
  if (!existsSync(path)) {
    return {
      forbiddenPackages: [],
      clientOnlyPackages: DEFAULT_CLIENT_ONLY,
      browserCapablePackages: DEFAULT_BROWSER_CAPABLE,
      largePackages: DEFAULT_LARGE_PACKAGES,
      tags: {},
      depConstraints: [],
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
    tags:
      typeof value.tags === "object" && value.tags
        ? (value.tags as Record<string, string[]>)
        : {},
    depConstraints: Array.isArray(value.depConstraints)
      ? (value.depConstraints as DepConstraint[])
      : [],
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
    if (isGatewayCodeFile(relativeFile)) {
      const uncancellable = fetchCallsWithoutSignal(source);
      if (uncancellable > 0) {
        issues.push({
          code: "fetch-without-timeout",
          severity: "fail",
          file: relativeFile,
          detail: `${uncancellable} gateway fetch call(s) pass no \`signal\` — add AbortSignal.timeout(ms) so a hung upstream cannot hold the request open`,
        });
      }
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
// added this check). Phase 1 (§2.2 Move A: `packages/trade-client` split into
// `@mvp/store` / `@mvp/islands` / `domains/trade-chart`; Move B:
// `packages/interaction/src/trade/*` moved to `domains/trade-contracts`) and
// Phase 2 (Move C: the trade source registry + `createTradeDataClient` moved
// from `packages/data` to `domains/trade-data`; Move D: the trade prefs moved
// from `packages/storage/src/prefs/*` to `domains/trade-prefs`; Move E:
// `createTradeAliasVariables` moved from `packages/design-system/src/themes.ts`
// to `domains/trade-theme`) have both landed, so every §2.2 leak this list
// used to carry is gone. Left empty on purpose (rather than deleted) so the
// allowlist doesn't silently mask a regression: any new domain-code-in-
// framework-package violation must fail, not get quietly added here.
const KNOWN_LEAKS: string[] = [];

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

/** Workspace groups scanned for taggable units. */
const TAGGABLE_GROUPS = ["apps", "domains", "fragments", "packages", "tools"];

type TaggedUnit = {
  /** `packages/runtime` */
  dir: string;
  /** `@mvp/runtime`, when the unit publishes a name. */
  packageName?: string;
  tags: string[];
};

/** Matches a `<group>/<name>` glob with a single trailing `*` wildcard. */
function matchesUnitGlob(pattern: string, dir: string): boolean {
  if (pattern === dir) return true;
  if (!pattern.includes("*")) return false;
  const [prefix, suffix = ""] = pattern.split("*");
  return dir.startsWith(prefix) && dir.endsWith(suffix);
}

export function collectTaggedUnits(
  root: string,
  tags: Record<string, string[]>,
): TaggedUnit[] {
  const units: TaggedUnit[] = [];
  for (const group of TAGGABLE_GROUPS) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      const dir = `${group}/${entry}`;
      const manifestPath = join(base, entry, "package.json");
      if (!existsSync(manifestPath)) continue;
      const unitTags = Object.entries(tags)
        .filter(([pattern]) => matchesUnitGlob(pattern, dir))
        .flatMap(([, value]) => value);
      units.push({
        dir,
        packageName: readJson<{ name?: string }>(manifestPath).name,
        tags: [...new Set(unitTags)],
      });
    }
  }
  return units;
}

/** Which tagged unit an import specifier resolves to, if any. */
function unitForSpecifier(
  root: string,
  file: string,
  specifier: string,
  units: TaggedUnit[],
): TaggedUnit | undefined {
  if (specifier.startsWith(".")) {
    const target = relativePosix(root, resolve(dirname(file), specifier));
    return units.find((unit) => target.startsWith(`${unit.dir}/`));
  }
  // `@mvp/runtime/react` must match the `@mvp/runtime` unit too.
  return units.find(
    (unit) =>
      unit.packageName !== undefined &&
      (specifier === unit.packageName ||
        specifier.startsWith(`${unit.packageName}/`)),
  );
}

export function auditDeclarativeLayering(
  root: string,
  tags: Record<string, string[]>,
  depConstraints: DepConstraint[],
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const units = collectTaggedUnits(root, tags);
  const constrained = units.filter((unit) => unit.tags.length > 0);

  for (const unit of constrained) {
    const applicable = depConstraints.filter((constraint) =>
      unit.tags.includes(constraint.sourceTag),
    );
    if (applicable.length === 0) continue;
    // `*` short-circuits: a unit allowed to depend on anything needs no scan.
    if (
      applicable.some((constraint) =>
        constraint.onlyDependOnLibsWithTags.includes("*"),
      )
    ) {
      continue;
    }
    const allowed = new Set(
      applicable.flatMap((constraint) => constraint.onlyDependOnLibsWithTags),
    );
    const files = walkFiles(join(root, unit.dir), isSourceFile);
    for (const file of files) {
      const relativeFile = relativePosix(root, file);
      if (isKnownLeak(relativeFile)) continue;
      const source = readFileSync(file, "utf8");
      for (const specifier of parseImports(source)) {
        const target = unitForSpecifier(root, file, specifier, units);
        if (!target || target.dir === unit.dir) continue;
        // An untagged target is unconstrained infrastructure, not a violation.
        if (target.tags.length === 0) continue;
        if (target.tags.some((tag) => allowed.has(tag))) continue;
        issues.push({
          code: "layer-constraint-violation",
          severity: "fail",
          file: relativeFile,
          detail: `a unit tagged "${unit.tags.join(", ")}" may only depend on units tagged ${[
            ...allowed,
          ]
            .map((tag) => `"${tag}"`)
            .join(
              " or ",
            )} — "${specifier}" is tagged "${target.tags.join(", ")}"`,
        });
      }
    }
  }
  return issues;
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

// Island orphan-bus audit (docs/ARCHITECTURE_REFACTOR_PLAN.md §4.3.2, goal C2):
// a React island that calls `createInteractionBus` directly with no way for
// the page to inject its shared bus is permanently cut off from cross-island
// publishes (the exact `account-bar` gap this phase fixed — see
// `fragments/account-bar/src/island.tsx` before/after). The fix pattern
// (already used by `market-header`/`chart-panel`/the fixed `account-bar`) is
// an optional `bus?: InteractionBus` prop the component prefers over its own
// `createInteractionBus` fallback. This is a regex heuristic, not a full AST
// check (matching the rest of this file's style, e.g. `hasRawFetch`): it
// flags any `fragments/*/src/island.tsx` that calls `createInteractionBus(`
// without the same file also declaring a `bus?` escape hatch somewhere
// (either a `bus?:` prop-type field or a `props.bus` destructure/access).
function hasCreateInteractionBusCall(source: string): boolean {
  return /\bcreateInteractionBus\s*\(/.test(source);
}

function hasBusEscapeHatch(source: string): boolean {
  return /\bbus\?\s*:/.test(source) || /\bprops\.bus\b/.test(source);
}

function auditIslandBusEscapeHatch(root: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const files = walkFiles(join(root, "fragments"), (path) =>
    path.endsWith("island.tsx"),
  );
  for (const file of files) {
    const relativeFile = relativePosix(root, file);
    const source = readFileSync(file, "utf8");
    if (!hasCreateInteractionBusCall(source)) continue;
    if (!hasBusEscapeHatch(source)) {
      issues.push({
        code: "island-bus-without-escape-hatch",
        severity: "fail",
        file: relativeFile,
        detail:
          "island.tsx calls createInteractionBus() with no optional `bus?` prop " +
          "escape hatch for the page-injected shared bus, so it can never receive " +
          "cross-island publishes (see market-header/chart-panel/account-bar's " +
          "`injectedBus ?? createInteractionBus(...)` pattern)",
      });
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

/**
 * Every fragment's `src/server.ts` must delegate to `@mvp/fragment-host`.
 *
 * That HTTP layer was copy-pasted 14 times (130–188 lines each, ≈90% identical,
 * already drifting) before it was extracted. `pnpm audit:similarity` could never
 * see it — it only fingerprints `.tsx` — and widening that audit to `.ts` turned
 * out to be pure noise (see the rationale in
 * `tools/component-similarity-check/src/index.ts`). So the guard against the
 * duplication coming back is this precise rule instead: hand-rolling a Fastify
 * server inside a fragment fails the build.
 *
 * Detection is deliberately narrow: a `server.ts` that imports the host passes,
 * whatever else it does (order-form legitimately adds an extra route). Only a
 * fragment that does NOT import the host is flagged.
 */
export function auditFragmentServerHost(root: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const fragmentsDir = join(root, "fragments");
  if (!existsSync(fragmentsDir)) return issues;
  for (const name of readdirSync(fragmentsDir)) {
    const serverFile = join(fragmentsDir, name, "src", "server.ts");
    if (!existsSync(serverFile)) continue;
    const source = readFileSync(serverFile, "utf8");
    if (source.includes("@mvp/fragment-host")) continue;
    issues.push({
      code: "fragment-server-not-hosted",
      severity: "fail",
      file: relativePosix(root, serverFile),
      detail:
        "fragment server must delegate to @mvp/fragment-host (createFragmentServer) instead of hand-rolling routes/metrics/trace export",
    });
  }
  return issues;
}

/**
 * Every `apps/*` and `fragments/*` unit is deployable on its own, and its
 * Dockerfile builds it with `pnpm --filter <unit>... build`. That closure is
 * computed from DECLARED dependencies, so a workspace package that a unit
 * imports but does not declare is never built: its `dist/` is absent and the
 * import fails to resolve. A whole-repo `pnpm build` cannot see this, because
 * it builds every package regardless of who declared what — so the repo's own
 * `pnpm verify` passed while `docker compose build` failed with
 * `Module not found: Can't resolve '@mvp/trade-prefs'`.
 *
 * Scope is the unit's shipped source only. Test files are excluded because they
 * are not part of the image, and `tools/*` is excluded because a scaffolder's
 * templates and this audit's own fixtures contain import specifiers inside
 * string literals — text that is not an import (the same false-positive class
 * `stripCommentsAndStrings` exists for, which cannot help here since an
 * import specifier IS a string).
 */
export function auditUndeclaredWorkspaceImports(root: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const workspacePackages = new Map<string, string>();
  for (const area of ["apps", "fragments", "packages", "domains"]) {
    const areaDir = join(root, area);
    if (!existsSync(areaDir)) continue;
    for (const entry of readdirSync(areaDir)) {
      const manifestPath = join(areaDir, entry, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = readJson<{ name?: string }>(manifestPath);
      if (manifest?.name) workspacePackages.set(manifest.name, manifestPath);
    }
  }

  for (const area of ["apps", "fragments"]) {
    const areaDir = join(root, area);
    if (!existsSync(areaDir)) continue;
    for (const entry of readdirSync(areaDir)) {
      const unitDir = join(areaDir, entry);
      const manifestPath = join(unitDir, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = readJson<{
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      }>(manifestPath);
      if (!manifest?.name) continue;
      const declared = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]);
      // First file that reveals each missing package, so the report points at
      // one concrete import rather than repeating the package per file.
      const missing = new Map<string, string>();
      for (const file of walkFiles(unitDir, isSourceFile)) {
        for (const specifier of parseImports(readFileSync(file, "utf8"))) {
          const packageName = workspacePackageName(specifier);
          if (
            packageName !== manifest.name &&
            workspacePackages.has(packageName) &&
            !declared.has(packageName) &&
            !missing.has(packageName)
          ) {
            missing.set(packageName, file);
          }
        }
      }
      for (const [packageName, file] of missing) {
        issues.push({
          code: "undeclared-workspace-import",
          severity: "fail",
          file: relativePosix(root, file),
          packageName,
          detail: `${manifest.name} imports ${packageName} but does not declare it, so \`pnpm --filter ${manifest.name}... build\` never builds it and the import cannot resolve in the unit's own image`,
        });
      }
    }
  }
  return issues;
}

/** `@mvp/runtime/react` -> `@mvp/runtime`; `next/headers` -> `next`. */
function workspacePackageName(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
}

function isBusinessCodeFile(path: string): boolean {
  return (
    /^apps\/page-[^/]+\/(app|src)\//.test(path) ||
    /^fragments\/[^/]+\/src\//.test(path)
  );
}

/**
 * The composition gateway is not "business code" — it proxies dynamic upstream
 * origins resolved from the route registry, which `@mvp/request`'s static
 * endpoint policies cannot express, so raw `fetch` is legitimate there. What is
 * NOT legitimate is a raw `fetch` with no cancellation: Node's fetch has no
 * default timeout and Fastify adds none, so one hung upstream holds a request
 * open on the single component every request passes through. This rule exists
 * because the original `isBusinessCodeFile` scope silently exempted exactly
 * that file.
 */
function isGatewayCodeFile(path: string): boolean {
  return /^apps\/shell-gateway\/src\//.test(path);
}

function hasRawFetch(source: string): boolean {
  // Match only real code: `fetch(` in a comment or a log/doc string is not a
  // raw network call (same false-positive class as browserGlobals).
  return /\bfetch\s*\(/.test(stripCommentsAndStrings(source));
}

/**
 * Finds `fetch(...)` calls whose argument list carries no `signal:`. Scans to
 * the matching close paren so a multi-line init object is covered; comments and
 * strings are stripped first, same heuristic as the rest of this file.
 */
export function fetchCallsWithoutSignal(source: string): number {
  const code = stripCommentsAndStrings(source);
  const pattern = /\bfetch\s*\(/g;
  let count = 0;
  let match: RegExpExecArray | null = pattern.exec(code);
  while (match !== null) {
    let depth = 0;
    let index = match.index + match[0].length - 1;
    for (; index < code.length; index += 1) {
      const char = code[index];
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const args = code.slice(match.index, index + 1);
    if (!/\bsignal\s*:/.test(args)) count += 1;
    match = pattern.exec(code);
  }
  return count;
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
