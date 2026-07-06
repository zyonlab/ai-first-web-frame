import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type CliOptions, parseArgs } from "../../_shared/args";
import { findWorkspaceRoot, readJson } from "../../_shared/fs";
import {
  exitCodeFor,
  statusFromCounts,
  writeReports,
} from "../../_shared/report";

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
  metric: Metric;
  actual: number;
  budget: number;
  status: "pass" | "fail";
};

export type BundleReport = {
  tool: "bundle-budget-check";
  status: "pass" | "warn" | "fail";
  checks: CheckRow[];
};

export function runBundleBudgetCheck(
  options: CliOptions = parseArgs(process.argv.slice(2)),
): BundleReport {
  const root = options.root ?? findWorkspaceRoot();
  const budgetPath = resolve(root, options.budget ?? "budget.json");
  const statsPath = resolve(root, options.stats ?? "stats.json");
  const budgets = existsSync(budgetPath)
    ? normalizeByScope(readJson<unknown>(budgetPath))
    : {};
  const stats = existsSync(statsPath)
    ? normalizeByScope(readJson<unknown>(statsPath))
    : {};
  const scopes = normalizeScopes(options.scope);
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
        metric,
        actual: actualValue,
        budget: Number.isFinite(budgetValue) ? budgetValue : -1,
        status: actualValue <= budgetValue ? "pass" : "fail",
      });
    }
  }

  const report: BundleReport = {
    tool: "bundle-budget-check",
    status: statusFromCounts(
      checks.filter((check) => check.status === "fail").length,
    ),
    checks,
  };

  writeReports(root, "bundle-report", report, renderMarkdown(report));
  return report;
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
      `| ${check.scope} | ${check.metric} | ${check.actual} | ${check.budget} | ${check.status} |`,
  );
  return [
    "# Bundle Budget Report",
    "",
    `Status: ${report.status}`,
    "",
    "| Scope | Metric | Actual | Budget | Status |",
    "| --- | --- | --- | --- | --- |",
    ...(rows.length > 0 ? rows : ["| - | - | - | - | - |"]),
  ].join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const options = parseArgs(process.argv.slice(2));
  const report = runBundleBudgetCheck(options);
  process.exitCode = exitCodeFor(report.status, options.ci, options.warnOnly);
}
