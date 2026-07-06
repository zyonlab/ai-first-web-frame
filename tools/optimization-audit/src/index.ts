import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createOptimizationFindings } from "@mvp/optimizer";
import { type CliOptions, parseArgs } from "../../_shared/args";
import { findWorkspaceRoot, relativePosix, walkFiles } from "../../_shared/fs";
import {
  exitCodeFor,
  statusFromCounts,
  writeReports,
} from "../../_shared/report";

type SlotCandidate = {
  name: string;
  fragment: string;
  strategy?: "static" | "isr" | "cached-ssr" | "dynamic-ssr";
  dependsOn?: string[];
};

export type OptimizationAuditReport = {
  tool: "optimization-audit";
  status: "pass" | "warn" | "fail";
  findings: ReturnType<typeof createOptimizationFindings>;
};

export function runOptimizationAudit(
  options: CliOptions = parseArgs(process.argv.slice(2)),
): OptimizationAuditReport {
  const root = options.root ?? findWorkspaceRoot();
  const slots = findPageManifestSlots(root);
  const findings = createOptimizationFindings({ slots });
  const report: OptimizationAuditReport = {
    tool: "optimization-audit",
    status: statusFromCounts(
      findings.filter((finding) => finding.severity === "critical").length,
      findings.length,
    ),
    findings,
  };
  writeReports(root, "optimization-findings", report, renderMarkdown(report));
  return report;
}

export function findPageManifestSlots(root: string): SlotCandidate[] {
  const appsRoot = join(root, "apps");
  if (!existsSync(appsRoot)) return [];
  return walkFiles(appsRoot, (path) => path.endsWith("src/manifest.ts"))
    .filter((path) =>
      /apps\/page-[^/]+\/src\/manifest\.ts$/.test(relativePosix(root, path)),
    )
    .flatMap((path) =>
      parseSlotsFromManifestSource(readFileSync(path, "utf8")),
    );
}

export function parseSlotsFromManifestSource(source: string): SlotCandidate[] {
  const slotsBlock = /slots:\s*\[([\s\S]*?)\]\s*,\s*budget:/m.exec(source)?.[1];
  if (!slotsBlock) return [];
  return [...slotsBlock.matchAll(/\{([\s\S]*?)\}/g)]
    .map((match) => match[1])
    .map((block) => {
      const name = readStringProperty(block, "name");
      const fragment = readStringProperty(block, "fragment");
      if (!name || !fragment) return null;
      const strategy = readStringProperty(block, "strategy") as
        | SlotCandidate["strategy"]
        | undefined;
      return {
        name,
        fragment,
        strategy,
        dependsOn: readArrayProperty(block, "dependsOn"),
      };
    })
    .filter((slot): slot is SlotCandidate => Boolean(slot));
}

function readStringProperty(block: string, property: string) {
  return new RegExp(`${property}:\\s*["']([^"']+)["']`).exec(block)?.[1];
}

function readArrayProperty(block: string, property: string) {
  const raw = new RegExp(`${property}:\\s*\\[([^\\]]*)\\]`).exec(block)?.[1];
  if (!raw) return [];
  return [...raw.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
}

function renderMarkdown(report: OptimizationAuditReport): string {
  const rows = report.findings.map(
    (finding) =>
      `| ${finding.severity} | ${finding.category} | ${finding.target} | ${finding.message} | ${finding.recommendation} |`,
  );
  return [
    "# Optimization Findings",
    "",
    `Status: ${report.status}`,
    "",
    "| Severity | Category | Target | Message | Recommendation |",
    "| --- | --- | --- | --- | --- |",
    ...(rows.length > 0 ? rows : ["| - | - | - | - | - |"]),
  ].join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const options = parseArgs(process.argv.slice(2));
  const report = runOptimizationAudit(options);
  process.exitCode = exitCodeFor(report.status, options.ci, options.warnOnly);
}
