import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createOptimizationFindings,
  formatEvidence,
  formatLocation,
  loadTraceSnapshots,
  SEVERITY_ORDER,
} from "@mvp/optimizer";
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
  manifestPath?: string;
};

const NO_TRACES_NOTE = "no runtime traces found; trace-based rules skipped";

export type OptimizationAuditConfig = {
  /** Directory containing RequestTraceSnapshot JSONL files. Defaults to <root>/reports/traces. */
  traceDir?: string;
};

export type OptimizationAuditReport = {
  tool: "optimization-audit";
  status: "pass" | "warn" | "fail";
  findings: ReturnType<typeof createOptimizationFindings>;
  traces: {
    dir: string;
    filesRead: number;
    snapshotCount: number;
    skippedLines: number;
    note?: string;
  };
};

export function runOptimizationAudit(
  options: CliOptions = parseArgs(process.argv.slice(2)),
  config: OptimizationAuditConfig = {},
): OptimizationAuditReport {
  const root = options.root ?? findWorkspaceRoot();
  const slots = findPageManifestSlots(root);
  const traceDir = config.traceDir ?? join(root, "reports", "traces");
  const traceLoad = loadTraceSnapshots(traceDir);
  const findings = createOptimizationFindings({
    slots,
    traces: traceLoad.snapshots,
  });
  const report: OptimizationAuditReport = {
    tool: "optimization-audit",
    status: statusFromCounts(
      findings.filter((finding) => finding.severity === "critical").length,
      findings.length,
    ),
    findings,
    traces: {
      dir: relativePosix(root, traceDir),
      filesRead: traceLoad.files.length,
      snapshotCount: traceLoad.snapshots.length,
      skippedLines: traceLoad.skippedLines,
      ...(traceLoad.snapshots.length === 0 ? { note: NO_TRACES_NOTE } : {}),
    },
  };
  writeReports(root, "optimization-findings", report, renderMarkdown(report));
  return report;
}

export function findPageManifestSlots(root: string): SlotCandidate[] {
  const appsRoot = join(root, "apps");
  if (!existsSync(appsRoot)) return [];
  const jsonPaths = walkFiles(appsRoot, (path) =>
    path.endsWith("manifest.slots.json"),
  ).filter((path) =>
    /apps\/page-[^/]+\/src\/manifest\.slots\.json$/.test(
      relativePosix(root, path),
    ),
  );
  const jsonDirs = new Set(jsonPaths.map((path) => dirname(path)));
  const tsPaths = walkFiles(appsRoot, (path) =>
    path.endsWith("src/manifest.ts"),
  )
    .filter((path) =>
      /apps\/page-[^/]+\/src\/manifest\.ts$/.test(relativePosix(root, path)),
    )
    // A JSON slots file wins over the legacy TS manifest in the same app.
    .filter((path) => !jsonDirs.has(dirname(path)));

  return [
    ...jsonPaths.flatMap((path) =>
      withManifestPath(
        parseSlotsFromJsonSource(readFileSync(path, "utf8")),
        relativePosix(root, path),
      ),
    ),
    ...tsPaths.flatMap((path) =>
      withManifestPath(
        parseSlotsFromManifestSource(readFileSync(path, "utf8")),
        relativePosix(root, path),
      ),
    ),
  ];
}

function withManifestPath(
  slots: SlotCandidate[],
  manifestPath: string,
): SlotCandidate[] {
  return slots.map((slot) => ({ ...slot, manifestPath }));
}

export function parseSlotsFromJsonSource(source: string): SlotCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return [];
  }
  const rawSlots = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { slots?: unknown[] })?.slots)
      ? ((parsed as { slots: unknown[] }).slots ?? [])
      : [];
  return rawSlots
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const slot = raw as Record<string, unknown>;
      if (typeof slot.name !== "string" || typeof slot.fragment !== "string")
        return null;
      return {
        name: slot.name,
        fragment: slot.fragment,
        strategy:
          typeof slot.strategy === "string"
            ? (slot.strategy as SlotCandidate["strategy"])
            : undefined,
        dependsOn: Array.isArray(slot.dependsOn)
          ? slot.dependsOn.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
      };
    })
    .filter((slot): slot is SlotCandidate => Boolean(slot));
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
  const lines = [
    "# Optimization Findings",
    "",
    `Status: ${report.status}`,
    "",
    report.traces.note
      ? `Traces: ${report.traces.note}`
      : `Traces: ${report.traces.snapshotCount} snapshot(s) from ${report.traces.dir} (${report.traces.filesRead} file(s), ${report.traces.skippedLines} malformed line(s) skipped)`,
    "",
  ];
  if (report.findings.length === 0) {
    lines.push("No findings.");
    return lines.join("\n");
  }
  for (const severity of SEVERITY_ORDER) {
    const group = report.findings.filter(
      (finding) => finding.severity === severity,
    );
    if (group.length === 0) continue;
    lines.push(`## ${severity.toUpperCase()} (${group.length})`, "");
    for (const finding of group) {
      lines.push(
        `### ${finding.category}: ${finding.target}`,
        "",
        finding.message,
        "",
        `- Location: ${formatLocation(finding.location)}`,
        `- Evidence: ${formatEvidence(finding.traceEvidence)}`,
        `- Recommendation: ${finding.recommendation}`,
        "",
      );
    }
  }
  return lines.join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const options = parseArgs(process.argv.slice(2));
  const report = runOptimizationAudit(options);
  process.exitCode = exitCodeFor(report.status, options.ci, options.warnOnly);
}
