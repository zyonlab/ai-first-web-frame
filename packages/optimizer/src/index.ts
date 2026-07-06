import type {
  DataDependency,
  OptimizationFinding,
  RenderStrategy,
} from "@mvp/contracts";
import { OptimizationFindingSchema } from "@mvp/contracts";
import type { RequestTraceSnapshot, TraceNode } from "@mvp/observability";

export type OptimizationInput = {
  trace?: RequestTraceSnapshot;
  dataDependencies?: DataDependency[];
  slots?: Array<{
    name: string;
    fragment: string;
    strategy?: RenderStrategy;
    props?: Record<string, unknown>;
    dependsOn?: string[];
  }>;
};

export function createOptimizationFindings(
  input: OptimizationInput,
): OptimizationFinding[] {
  return [
    ...findDuplicateTraceAttribute(input.trace, "network", "url", "network"),
    ...findDuplicateTraceAttribute(input.trace, "data", "key", "data"),
    ...findStaticDataCandidates(input.dataDependencies ?? []),
    ...findStaticSlotCandidates(
      input.slots ?? [],
      input.dataDependencies ?? [],
    ),
  ];
}

export function createOptimizationMarkdown(findings: OptimizationFinding[]) {
  if (findings.length === 0) return "# Optimization Findings\n\nNo findings.\n";
  const lines = ["# Optimization Findings", ""];
  for (const finding of findings) {
    lines.push(
      `## ${finding.severity.toUpperCase()} ${finding.category}: ${finding.target}`,
      "",
      finding.message,
      "",
      `Recommendation: ${finding.recommendation}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function findDuplicateTraceAttribute(
  trace: RequestTraceSnapshot | undefined,
  kind: TraceNode["kind"],
  attribute: string,
  category: OptimizationFinding["category"],
) {
  if (!trace) return [];
  const grouped = new Map<string, TraceNode[]>();
  for (const node of trace.nodes) {
    if (node.kind !== kind) continue;
    const value = node.attributes[attribute];
    if (typeof value !== "string" || !value) continue;
    grouped.set(value, [...(grouped.get(value) ?? []), node]);
  }

  const findings: OptimizationFinding[] = [];
  for (const [value, nodes] of grouped.entries()) {
    if (nodes.length < 2) continue;
    findings.push(
      OptimizationFindingSchema.parse({
        id: `duplicate-${kind}-${hashId(value)}`,
        severity: "medium",
        category,
        target: value,
        message: `${nodes.length} ${kind} spans used the same ${attribute}.`,
        evidence: {
          traceId: trace.traceId,
          spanIds: nodes.map((node) => node.id),
        },
        recommendation:
          kind === "data"
            ? "Route this data through @mvp/data request dedupe and cache policy."
            : "Route this endpoint through @mvp/request or @mvp/data so duplicate calls are deduped.",
      }),
    );
  }
  return findings;
}

function findStaticDataCandidates(dependencies: DataDependency[]) {
  return dependencies
    .filter(
      (dependency) =>
        dependency.privacy === "public" &&
        dependency.freshness === "request-time" &&
        dependency.source !== "subscription",
    )
    .map((dependency) =>
      OptimizationFindingSchema.parse({
        id: `static-data-${dependency.id}`,
        severity: "low",
        category: "ssg",
        target: dependency.id,
        message: `Public request-time data "${dependency.id}" may be eligible for build-time or ISR rendering.`,
        evidence: { dependency },
        recommendation:
          "Classify this data as build-time or isr if it does not require per-request state.",
      }),
    );
}

function findStaticSlotCandidates(
  slots: NonNullable<OptimizationInput["slots"]>,
  dependencies: DataDependency[],
) {
  const dynamicPrivateData = dependencies.some(
    (dependency) =>
      dependency.privacy === "user-private" ||
      dependency.freshness === "realtime" ||
      dependency.freshness === "client-local",
  );
  if (dynamicPrivateData) return [];

  return slots
    .filter(
      (slot) =>
        (slot.strategy ?? "dynamic-ssr") === "dynamic-ssr" &&
        (slot.dependsOn ?? []).length === 0,
    )
    .map((slot) =>
      OptimizationFindingSchema.parse({
        id: `static-slot-${slot.name}`,
        severity: "info",
        category: "ssg",
        target: slot.name,
        message: `Slot "${slot.name}" has no declared dependencies and may not need dynamic SSR.`,
        evidence: { fragment: slot.fragment, props: slot.props ?? {} },
        recommendation:
          "Change the slot strategy to static, isr, or cached-ssr if its content is deterministic.",
      }),
    );
}

function hashId(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1)
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}
