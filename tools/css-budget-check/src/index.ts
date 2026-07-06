import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type CliOptions, parseArgs } from "../../_shared/args";
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

type CssBudget = {
  totalCssBytes?: number;
  unusedCssBytes?: number;
  duplicatedRules?: number;
  globalSelectors?: number;
  importantCount?: number;
};

type CssFinding = {
  type: "duplicated-rule" | "global-selector";
  file: string;
  value: string;
};

export type CssReport = {
  tool: "css-budget-check";
  status: "pass" | "warn" | "fail";
  metrics: {
    totalCssBytes: number;
    unusedCssBytes: number;
    duplicatedRules: number;
    globalSelectors: number;
    importantCount: number;
    cssModuleUsage: {
      moduleFiles: number;
      totalFiles: number;
      ratio: number;
    };
  };
  budget: CssBudget;
  findings: CssFinding[];
};

export async function runCssBudgetCheck(
  options: CliOptions = parseArgs(process.argv.slice(2)),
): Promise<CssReport> {
  const root = options.root ?? findWorkspaceRoot();
  const cssFiles = discoverCssFiles(root, options.css);
  const sourceText = discoverSourceText(root);
  const budget = readBudget(root);
  const findings: CssFinding[] = [];
  let totalCssBytes = 0;
  let unusedCssBytes = 0;
  let importantCount = 0;
  let duplicatedRules = 0;
  let globalSelectors = 0;

  for (const file of cssFiles) {
    const css = readFileSync(file, "utf8");
    const minified = await minifyWithLightningFallback(css, file);
    totalCssBytes += Buffer.byteLength(minified);
    importantCount += (css.match(/!important\b/g) ?? []).length;
    const rules = parseRules(css);
    const seen = new Map<string, number>();
    for (const rule of rules) {
      const key = `${rule.selector}{${rule.body.replace(/\s+/g, "")}}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (isGlobalSelector(rule.selector)) {
        globalSelectors += 1;
        findings.push({
          type: "global-selector",
          file: relativePosix(root, file),
          value: rule.selector,
        });
      }
      for (const className of rule.selector.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
        if (!sourceText.includes(className[1])) {
          unusedCssBytes += Buffer.byteLength(rule.body);
        }
      }
    }
    for (const [rule, count] of seen) {
      if (count > 1) {
        duplicatedRules += count - 1;
        findings.push({
          type: "duplicated-rule",
          file: relativePosix(root, file),
          value: rule,
        });
      }
    }
  }

  const metrics = {
    totalCssBytes,
    unusedCssBytes,
    duplicatedRules,
    globalSelectors,
    importantCount,
    cssModuleUsage: {
      moduleFiles: cssFiles.filter((file) => file.endsWith(".module.css"))
        .length,
      totalFiles: cssFiles.length,
      ratio:
        cssFiles.length === 0
          ? 1
          : Number(
              (
                cssFiles.filter((file) => file.endsWith(".module.css")).length /
                cssFiles.length
              ).toFixed(4),
            ),
    },
  };
  const failureCount = Object.entries(budget).filter(([key, value]) => {
    const actual = metrics[key as keyof CssBudgetMetrics];
    return (
      typeof value === "number" && typeof actual === "number" && actual > value
    );
  }).length;
  const report: CssReport = {
    tool: "css-budget-check",
    status: statusFromCounts(failureCount),
    metrics,
    budget,
    findings,
  };

  writeReports(root, "css-report", report, renderMarkdown(report));
  return report;
}

function discoverCssFiles(root: string, cssPath?: string): string[] {
  if (cssPath) {
    const resolved = resolve(root, cssPath);
    return existsSync(resolved) ? [resolved] : [];
  }
  return [
    ...walkFiles(join(root, "packages"), (path) => path.endsWith(".css")),
    ...walkFiles(join(root, "fragments"), (path) => path.endsWith(".css")),
  ];
}

function discoverSourceText(root: string): string {
  return [
    ...walkFiles(join(root, "packages"), (path) =>
      /\.(tsx|ts|jsx|js)$/.test(path),
    ),
    ...walkFiles(join(root, "fragments"), (path) =>
      /\.(tsx|ts|jsx|js)$/.test(path),
    ),
  ]
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function readBudget(root: string): CssBudget {
  const path = join(root, "budget.json");
  if (!existsSync(path)) {
    return {};
  }
  const value = readJson<Record<string, unknown>>(path);
  const source = (
    value.css && typeof value.css === "object" ? value.css : value
  ) as Record<string, unknown>;
  const budget: CssBudget = {};
  for (const key of [
    "totalCssBytes",
    "unusedCssBytes",
    "duplicatedRules",
    "globalSelectors",
    "importantCount",
  ] as const) {
    if (typeof source[key] === "number") {
      budget[key] = source[key];
    }
  }
  if (typeof source.cssBytes === "number") {
    budget.totalCssBytes = source.cssBytes;
  }
  return budget;
}

async function minifyWithLightningFallback(
  css: string,
  filename: string,
): Promise<string> {
  try {
    const dynamicImport = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<unknown>;
    const lightning = (await dynamicImport("lightningcss")) as {
      transform: (input: {
        filename: string;
        code: Buffer;
        minify: boolean;
      }) => { code: Buffer };
    };
    return lightning
      .transform({ filename, code: Buffer.from(css), minify: true })
      .code.toString();
  } catch {
    return css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ")
      .replace(/\s*([{}:;,>])\s*/g, "$1")
      .trim();
  }
}

type CssBudgetMetrics = Omit<CssReport["metrics"], "cssModuleUsage">;

function parseRules(css: string): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/([^{}@][^{}]*){([^{}]*)}/g)) {
    rules.push({ selector: match[1].trim(), body: match[2].trim() });
  }
  return rules;
}

function isGlobalSelector(selector: string): boolean {
  return selector
    .split(",")
    .map((part) => part.trim())
    .some(
      (part) =>
        /^(html|body|:root|\*)\b/.test(part) ||
        (!part.includes(".") && !part.includes("#") && /^[a-z]/.test(part)),
    );
}

function renderMarkdown(report: CssReport): string {
  return [
    "# CSS Budget Report",
    "",
    `Status: ${report.status}`,
    "",
    "| Metric | Actual | Budget |",
    "| --- | --- | --- |",
    `| totalCssBytes | ${report.metrics.totalCssBytes} | ${report.budget.totalCssBytes ?? "-"} |`,
    `| unusedCssBytes | ${report.metrics.unusedCssBytes} | ${report.budget.unusedCssBytes ?? "-"} |`,
    `| duplicatedRules | ${report.metrics.duplicatedRules} | ${report.budget.duplicatedRules ?? "-"} |`,
    `| globalSelectors | ${report.metrics.globalSelectors} | ${report.budget.globalSelectors ?? "-"} |`,
    `| importantCount | ${report.metrics.importantCount} | ${report.budget.importantCount ?? "-"} |`,
  ].join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const options = parseArgs(process.argv.slice(2));
  const report = await runCssBudgetCheck(options);
  process.exitCode = exitCodeFor(report.status, options.ci, options.warnOnly);
}
