import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { build as esbuildBundle } from "esbuild";
import { type CliOptions, parseArgs } from "../../_shared/args";
import { loadUnitBudgets, type UnitBudget } from "../../_shared/budgets";
import { findWorkspaceRoot, readJson } from "../../_shared/fs";
import {
  exitCodeFor,
  statusFromCounts,
  writeReports,
} from "../../_shared/report";

/**
 * Bundle budget gate. The budget side comes from the per-unit
 * `fragments/<name>/src/budget.ts` / `apps/<name>/src/budget.ts` files
 * (loaded by `tools/_shared/budgets.ts`); the actual side is measured from
 * the repo, per unit class:
 *
 * - **Pages** (`apps/page-*`, scope "page"): first-load client JS from the
 *   real `next build` output — the union of every app route's files in
 *   `.next/app-build-manifest.json` plus `build-manifest.json`'s
 *   `rootMainFiles` (route handlers and `/_not-found` excluded, polyfills
 *   excluded, matching Next's own first-load accounting). Measured as
 *   **gzipped bytes** (wire weight — the scale the 180KB default page budget
 *   was written in). `.next` is generated, not checked in: `pnpm verify`
 *   runs `pnpm build` before `audit:bundle`, so artifacts are always fresh
 *   there; a standalone `pnpm audit:bundle` on an unbuilt tree FAILS loudly
 *   per page with a "not built" row (actual = -1) instead of passing on
 *   nothing.
 * - **Fragments** (scope "fragment"): fragments ship their client code into
 *   the consuming page's bundle (D3 convention: React + `@mvp/*` shared
 *   vendor are charged to the page, only fragment-owned island/patch glue is
 *   charged to the fragment). The gate reproduces the documented
 *   measurement (see `fragments/order-form/src/budget.ts`): esbuild-bundle
 *   the fragment's client entry (`src/island.browser.ts` > `src/client.ts` >
 *   `src/island.tsx`, first match) with `react`, `react-dom` and `@mvp/*`
 *   external, minified. Measured as **minified (pre-gzip) bytes** — the
 *   unit the fragment budget comments are written in. Fragments with no
 *   client entry are SSR-only: actual 0 with an explicit note (inline SSR
 *   `<script>` content is NOT counted; that is HTML weight).
 *
 * Explicitly NOT measured here (listed in the report, never silently
 * passed): fragment `cssBytes` (enforced by `css-budget-check` /
 * `audit:css` from source CSS), page `cssBytes` when the build emits no
 * extracted `.css` asset (this repo inlines page styles into the HTML), and
 * runtime-only metrics (`rscPayloadBytes`, TTFB/LCP/INP/CLS, render/memory
 * ceilings).
 *
 * A root `budget.json`/`stats.json` pair is still honored when present
 * (legacy scope-level contract), but the per-unit gate above runs
 * regardless.
 */

const METRICS = [
  "jsBytes",
  "cssBytes",
  "rscPayloadBytes",
  "htmlBytes",
  "imageBytes",
  "dependencyCount",
  "duplicatedDependencies",
] as const;
const SCOPES = ["component", "fragment", "page", "shell"] as const;

type Metric = (typeof METRICS)[number];
type Scope = (typeof SCOPES)[number];
type MetricMap = Partial<Record<Metric, number>>;

type CheckRow = {
  scope: Scope;
  /** Unit name ("order-book", "page-home") or "(root)" for legacy rows. */
  unit: string;
  metric: Metric;
  /** Measured value; -1 means "artifact missing" (always a fail). */
  actual: number;
  budget: number;
  status: "pass" | "fail";
  /** What was measured, so the report is auditable. */
  measurement: string;
  note?: string;
};

type UnmeasuredRow = {
  unit: string;
  metric: string;
  reason: string;
};

export type BundleReport = {
  tool: "bundle-budget-check";
  status: "pass" | "warn" | "fail";
  checks: CheckRow[];
  unmeasured: UnmeasuredRow[];
  notes: string[];
};

/** Fragment client entry candidates, most specific first. */
const FRAGMENT_CLIENT_ENTRIES = [
  "island.browser.ts",
  "client.ts",
  "island.tsx",
] as const;

/** Modules charged to the consuming page, not the fragment (D3). */
const FRAGMENT_EXTERNALS = [
  "react",
  "react-dom",
  "react/*",
  "react-dom/*",
  "@mvp/*",
];

export async function runBundleBudgetCheck(
  options: CliOptions = parseArgs(process.argv.slice(2)),
): Promise<BundleReport> {
  const root = options.root ?? findWorkspaceRoot();
  const scopes = normalizeScopes(options.scope);
  const checks: CheckRow[] = [];
  const unmeasured: UnmeasuredRow[] = [];

  const unitBudgets = (await loadUnitBudgets(root)).filter((unit) =>
    scopes.includes(unit.scope),
  );
  for (const unit of unitBudgets) {
    if (unit.scope === "fragment") {
      await checkFragment(root, unit, checks, unmeasured);
    } else if (unit.scope === "page") {
      checkPage(root, unit, checks, unmeasured);
    } else if (unit.jsBytes !== undefined || unit.cssBytes !== undefined) {
      unmeasured.push({
        unit: unit.name,
        metric: "jsBytes/cssBytes",
        reason: `no measurement implemented for scope "${unit.scope}"`,
      });
    }
  }

  checks.push(...legacyRootChecks(root, options, scopes));

  const report: BundleReport = {
    tool: "bundle-budget-check",
    status: statusFromCounts(
      checks.filter((check) => check.status === "fail").length,
    ),
    checks,
    unmeasured,
    notes: [
      "Fragment jsBytes = minified esbuild bundle of the fragment's client entry with react/react-dom/@mvp/* external (shared vendor is charged to the consuming page).",
      "Page jsBytes = gzipped first-load client JS from the .next build manifests.",
      "Fragment cssBytes ceilings are enforced by css-budget-check (pnpm audit:css), not here.",
      "Runtime-only budget metrics (rscPayloadBytes, TTFB/LCP/INP/CLS, render/memory) are not statically measurable and are not gated by this audit.",
    ],
  };

  writeReports(root, "bundle-report", report, renderMarkdown(report));
  return report;
}

/** Measures a fragment's client-facing JS and gates it against jsBytes. */
async function checkFragment(
  root: string,
  unit: UnitBudget,
  checks: CheckRow[],
  unmeasured: UnmeasuredRow[],
): Promise<void> {
  if (unit.cssBytes !== undefined) {
    unmeasured.push({
      unit: unit.name,
      metric: "cssBytes",
      reason: "enforced by css-budget-check (pnpm audit:css)",
    });
  }
  if (unit.jsBytes === undefined) {
    return;
  }
  const srcDir = join(root, unit.dir, "src");
  const entry = FRAGMENT_CLIENT_ENTRIES.map((file) => join(srcDir, file)).find(
    (file) => existsSync(file),
  );
  if (!entry) {
    checks.push({
      scope: "fragment",
      unit: unit.name,
      metric: "jsBytes",
      actual: 0,
      budget: unit.jsBytes,
      status: 0 <= unit.jsBytes ? "pass" : "fail",
      measurement: "no client entry (ssr-only fragment)",
      note: "inline SSR <script> content, if any, is not counted",
    });
    return;
  }
  try {
    const result = await esbuildBundle({
      entryPoints: [entry],
      bundle: true,
      minify: true,
      format: "esm",
      platform: "browser",
      write: false,
      external: [...FRAGMENT_EXTERNALS],
      jsx: "automatic",
      logLevel: "silent",
    });
    const bytes = result.outputFiles.reduce(
      (sum, file) => sum + file.contents.byteLength,
      0,
    );
    checks.push({
      scope: "fragment",
      unit: unit.name,
      metric: "jsBytes",
      actual: bytes,
      budget: unit.jsBytes,
      status: bytes <= unit.jsBytes ? "pass" : "fail",
      measurement: `esbuild bundle of ${relativeEntry(root, entry)} (react/@mvp externals), minified bytes`,
    });
  } catch (error) {
    checks.push({
      scope: "fragment",
      unit: unit.name,
      metric: "jsBytes",
      actual: -1,
      budget: unit.jsBytes,
      status: "fail",
      measurement: `esbuild bundle of ${relativeEntry(root, entry)}`,
      note: `bundle failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
    });
  }
}

function relativeEntry(root: string, entry: string): string {
  return entry
    .slice(root.length + 1)
    .split("\\")
    .join("/");
}

/** Gates a page's first-load JS (and built CSS, if any) from `.next`. */
function checkPage(
  root: string,
  unit: UnitBudget,
  checks: CheckRow[],
  unmeasured: UnmeasuredRow[],
): void {
  if (unit.jsBytes === undefined && unit.cssBytes === undefined) {
    return;
  }
  const nextDir = join(root, unit.dir, ".next");
  const appManifestPath = join(nextDir, "app-build-manifest.json");
  const buildManifestPath = join(nextDir, "build-manifest.json");
  if (!existsSync(appManifestPath) || !existsSync(buildManifestPath)) {
    for (const metric of ["jsBytes", "cssBytes"] as const) {
      if (unit[metric] === undefined) {
        continue;
      }
      checks.push({
        scope: "page",
        unit: unit.name,
        metric,
        actual: -1,
        budget: unit[metric],
        status: "fail",
        measurement: `first-load ${metric === "jsBytes" ? "JS" : "CSS"} from ${unit.dir}/.next`,
        note: "page not built (.next missing): run `pnpm build` before audit:bundle",
      });
    }
    return;
  }

  const appManifest = readJson<{ pages?: Record<string, string[]> }>(
    appManifestPath,
  );
  const buildManifest = readJson<{ rootMainFiles?: string[] }>(
    buildManifestPath,
  );
  const files = new Set<string>(buildManifest.rootMainFiles ?? []);
  for (const [route, routeFiles] of Object.entries(appManifest.pages ?? {})) {
    // Route handlers and the built-in not-found page are not user-facing
    // first loads.
    if (route.endsWith("/route") || route === "/_not-found/page") {
      continue;
    }
    for (const file of routeFiles) {
      files.add(file);
    }
  }

  let jsGzipBytes = 0;
  let cssGzipBytes = 0;
  let cssFileCount = 0;
  const missing: string[] = [];
  for (const file of files) {
    const path = join(nextDir, file);
    if (!existsSync(path)) {
      missing.push(file);
      continue;
    }
    const gzBytes = gzipSync(readFileSync(path)).byteLength;
    if (file.endsWith(".css")) {
      cssGzipBytes += gzBytes;
      cssFileCount += 1;
    } else {
      jsGzipBytes += gzBytes;
    }
  }

  if (unit.jsBytes !== undefined) {
    const stale = missing.length > 0;
    checks.push({
      scope: "page",
      unit: unit.name,
      metric: "jsBytes",
      actual: stale ? -1 : jsGzipBytes,
      budget: unit.jsBytes,
      status: !stale && jsGzipBytes <= unit.jsBytes ? "pass" : "fail",
      measurement: "Next first-load JS (.next manifests), gzipped bytes",
      note: stale
        ? `stale build: ${missing.length} manifest file(s) missing on disk — rerun pnpm build`
        : undefined,
    });
  }
  if (unit.cssBytes !== undefined) {
    if (cssFileCount === 0) {
      unmeasured.push({
        unit: unit.name,
        metric: "cssBytes",
        reason:
          "build emits no extracted .css asset (page styles are inline-injected); not gated here",
      });
    } else {
      checks.push({
        scope: "page",
        unit: unit.name,
        metric: "cssBytes",
        actual: cssGzipBytes,
        budget: unit.cssBytes,
        status: cssGzipBytes <= unit.cssBytes ? "pass" : "fail",
        measurement: "Next first-load CSS (.next manifests), gzipped bytes",
      });
    }
  }
}

/** Legacy root `budget.json` vs `stats.json` contract, kept when present. */
function legacyRootChecks(
  root: string,
  options: CliOptions,
  scopes: Scope[],
): CheckRow[] {
  const budgetPath = resolve(root, options.budget ?? "budget.json");
  const statsPath = resolve(root, options.stats ?? "stats.json");
  const budgets = existsSync(budgetPath)
    ? normalizeByScope(readJson<unknown>(budgetPath))
    : {};
  const stats = existsSync(statsPath)
    ? normalizeByScope(readJson<unknown>(statsPath))
    : {};
  const checks: CheckRow[] = [];
  for (const scope of scopes) {
    const budget = budgets[scope] ?? {};
    const actual = stats[scope] ?? {};
    for (const metric of METRICS) {
      if (budget[metric] === undefined && actual[metric] === undefined) {
        continue;
      }
      const actualValue = actual[metric] ?? 0;
      const budgetValue = budget[metric] ?? Number.POSITIVE_INFINITY;
      checks.push({
        scope,
        unit: "(root)",
        metric,
        actual: actualValue,
        budget: Number.isFinite(budgetValue) ? budgetValue : -1,
        status: actualValue <= budgetValue ? "pass" : "fail",
        measurement: "legacy root budget.json vs stats.json",
      });
    }
  }
  return checks;
}

function normalizeScopes(scope?: string): Scope[] {
  if (!scope) {
    return [...SCOPES];
  }
  if (!SCOPES.includes(scope as Scope)) {
    throw new Error(`Unsupported scope: ${scope}`);
  }
  return [scope as Scope];
}

function normalizeByScope(input: unknown): Partial<Record<Scope, MetricMap>> {
  if (!input || typeof input !== "object") {
    return {};
  }
  const value = input as Record<string, unknown>;
  if (Array.isArray(value.scopes)) {
    return Object.fromEntries(
      value.scopes.map((entry) => [
        String((entry as { scope?: string }).scope),
        pickMetrics(entry),
      ]),
    ) as Partial<Record<Scope, MetricMap>>;
  }
  if (typeof value.scope === "string") {
    return { [value.scope]: pickMetrics(value) } as Partial<
      Record<Scope, MetricMap>
    >;
  }
  const result: Partial<Record<Scope, MetricMap>> = {};
  for (const scope of SCOPES) {
    if (value[scope] && typeof value[scope] === "object") {
      result[scope] = pickMetrics(value[scope]);
    }
  }
  return result;
}

function pickMetrics(input: unknown): MetricMap {
  const source = input as Record<string, unknown>;
  const metricsSource =
    source.budgets && typeof source.budgets === "object"
      ? (source.budgets as Record<string, unknown>)
      : source;
  const result: MetricMap = {};
  for (const metric of METRICS) {
    const raw = metricsSource[metric];
    if (typeof raw === "number") {
      result[metric] = raw;
    }
  }
  return result;
}

function renderMarkdown(report: BundleReport): string {
  const rows = report.checks.map(
    (check) =>
      `| ${check.scope} | ${check.unit} | ${check.metric} | ${check.actual} | ${check.budget} | ${check.status} | ${check.note ?? check.measurement} |`,
  );
  const unmeasuredRows = report.unmeasured.map(
    (row) => `| ${row.unit} | ${row.metric} | ${row.reason} |`,
  );
  return [
    "# Bundle Budget Report",
    "",
    `Status: ${report.status}`,
    "",
    "| Scope | Unit | Metric | Actual | Budget | Status | Detail |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...(rows.length > 0 ? rows : ["| - | - | - | - | - | - | - |"]),
    "",
    "## Not measured by this audit",
    "",
    "| Unit | Metric | Reason |",
    "| --- | --- | --- |",
    ...(unmeasuredRows.length > 0 ? unmeasuredRows : ["| - | - | - |"]),
    "",
    ...report.notes.map((note) => `- ${note}`),
  ].join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const options = parseArgs(process.argv.slice(2));
  const report = await runBundleBudgetCheck(options);
  process.exitCode = exitCodeFor(report.status, options.ci, options.warnOnly);
}
