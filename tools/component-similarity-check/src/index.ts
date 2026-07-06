import { readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { type CliOptions, parseArgs } from "../../_shared/args";
import { classNames, jsxShape, parseImports } from "../../_shared/code";
import { findWorkspaceRoot, relativePosix, walkFiles } from "../../_shared/fs";
import {
  exitCodeFor,
  statusFromCounts,
  writeReports,
} from "../../_shared/report";
import {
  jaccard,
  normalizedNameSimilarity,
  uniqueTokens,
} from "../../_shared/text";

type ComponentFingerprint = {
  name: string;
  file: string;
  category: string;
  props: string[];
  dependencies: string[];
  sourceTokens: string[];
  cssClasses: string[];
  jsxShape: string[];
};

type SimilarityMatch = {
  left: string;
  right: string;
  score: number;
  dimensions: Record<string, number>;
};

export type SimilarityReport = {
  tool: "component-similarity-check";
  status: "pass" | "warn" | "fail";
  threshold: number;
  checkedFiles: string[];
  matches: SimilarityMatch[];
};

export function runSimilarityCheck(
  options: CliOptions = parseArgs(process.argv.slice(2)),
): SimilarityReport {
  const root = options.root ?? findWorkspaceRoot();
  const threshold = Number.isFinite(options.threshold)
    ? (options.threshold ?? 0.82)
    : 0.82;
  const components = discoverComponents(root);
  const matches: SimilarityMatch[] = [];

  for (let leftIndex = 0; leftIndex < components.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < components.length;
      rightIndex += 1
    ) {
      const match = compareComponents(
        components[leftIndex],
        components[rightIndex],
      );
      if (match.score >= threshold) {
        matches.push(match);
      }
    }
  }

  const status = statusFromCounts(matches.length);
  const report: SimilarityReport = {
    tool: "component-similarity-check",
    status,
    threshold,
    checkedFiles: components.map((component) => component.file).sort(),
    matches: matches.sort(
      (a, b) => b.score - a.score || a.left.localeCompare(b.left),
    ),
  };

  writeReports(root, "similarity-report", report, renderMarkdown(report));
  return report;
}

function discoverComponents(root: string): ComponentFingerprint[] {
  const uiFiles = walkFiles(
    join(root, "packages", "ui"),
    (path) => path.endsWith(".tsx") && !path.endsWith(".test.tsx"),
  );
  const fragmentFiles = walkFiles(
    join(root, "fragments"),
    (path) =>
      path.includes(`${join("src")}`) &&
      path.endsWith(".tsx") &&
      !path.endsWith(".test.tsx"),
  );
  return [...uiFiles, ...fragmentFiles].map((file) => fingerprint(root, file));
}

function fingerprint(root: string, file: string): ComponentFingerprint {
  const source = readFileSync(file, "utf8");
  const metadata = readMetadata(dirname(file));
  return {
    name: metadata.name ?? basename(file).replace(/\.tsx$/, ""),
    file: relativePosix(root, file),
    category: metadata.category ?? inferCategory(root, file),
    props: extractProps(source),
    dependencies: parseImports(source).filter((item) => !item.startsWith(".")),
    sourceTokens: uniqueTokens(source),
    cssClasses: classNames(source),
    jsxShape: jsxShape(source),
  };
}

function readMetadata(
  componentDir: string,
): Partial<{ name: string; category: string }> {
  const metadataPath = join(componentDir, "metadata.ts");
  try {
    const metadata = readFileSync(metadataPath, "utf8");
    return {
      name: /name\s*:\s*["']([^"']+)["']/.exec(metadata)?.[1],
      category: /category\s*:\s*["']([^"']+)["']/.exec(metadata)?.[1],
    };
  } catch {
    return {};
  }
}

function inferCategory(root: string, file: string): string {
  const path = relative(root, file);
  if (path.startsWith(`fragments/`)) {
    return "fragment";
  }
  return "ui";
}

function extractProps(source: string): string[] {
  const props = new Set<string>();
  for (const match of source.matchAll(
    /(?:type|interface)\s+[A-Za-z0-9_]*Props[^{=]*(?:=)?\s*{([^}]+)}/gms,
  )) {
    for (const prop of match[1].matchAll(/([A-Za-z0-9_]+)\??\s*:/g)) {
      props.add(prop[1]);
    }
  }
  return [...props].sort();
}

function compareComponents(
  left: ComponentFingerprint,
  right: ComponentFingerprint,
): SimilarityMatch {
  const dimensions = {
    name: normalizedNameSimilarity(left.name, right.name),
    category: left.category === right.category ? 1 : 0,
    props: jaccard(left.props, right.props),
    dependencies: jaccard(left.dependencies, right.dependencies),
    sourceTokens: jaccard(left.sourceTokens, right.sourceTokens),
    cssClasses: jaccard(left.cssClasses, right.cssClasses),
    jsxShape: jaccard(left.jsxShape, right.jsxShape),
  };
  const score =
    dimensions.name * 0.16 +
    dimensions.category * 0.1 +
    dimensions.props * 0.16 +
    dimensions.dependencies * 0.1 +
    dimensions.sourceTokens * 0.2 +
    dimensions.cssClasses * 0.12 +
    dimensions.jsxShape * 0.16;
  return {
    left: left.file,
    right: right.file,
    score: Number(score.toFixed(4)),
    dimensions: Object.fromEntries(
      Object.entries(dimensions).map(([key, value]) => [
        key,
        Number(value.toFixed(4)),
      ]),
    ),
  };
}

function renderMarkdown(report: SimilarityReport): string {
  const rows = report.matches.map(
    (match) => `| ${match.left} | ${match.right} | ${match.score} |`,
  );
  return [
    "# Component Similarity Report",
    "",
    `Status: ${report.status}`,
    `Threshold: ${report.threshold}`,
    `Checked files: ${report.checkedFiles.length}`,
    "",
    "| Left | Right | Score |",
    "| --- | --- | --- |",
    ...(rows.length > 0 ? rows : ["| - | - | - |"]),
  ].join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const options = parseArgs(process.argv.slice(2));
  const report = runSimilarityCheck(options);
  process.exitCode = exitCodeFor(report.status, options.ci, options.warnOnly);
}
