import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  DataDependency,
  OptimizationEvidence,
  OptimizationFinding,
  RenderStrategy,
} from "@mvp/contracts";
import { OptimizationFindingSchema } from "@mvp/contracts";
import type { RequestTraceSnapshot, TraceNode } from "@mvp/observability";

export type OptimizationThresholds = {
  /** Max gap (ms) between a span ending and the next starting to count as a serial waterfall. */
  waterfallMaxGapMs?: number;
  /** Minimum observed cache lookups before the cache hit-rate rule fires. */
  cacheMinSamples?: number;
  /** Miss rate above which a cache finding is produced (0..1). */
  cacheMaxMissRate?: number;
};

const DEFAULT_THRESHOLDS: Required<OptimizationThresholds> = {
  waterfallMaxGapMs: 50,
  cacheMinSamples: 3,
  cacheMaxMissRate: 0.5,
};

export type SlotInput = {
  name: string;
  fragment: string;
  strategy?: RenderStrategy;
  props?: Record<string, unknown>;
  dependsOn?: string[];
  /** Workspace-relative path of the manifest the slot was parsed from. */
  manifestPath?: string;
};

export type OptimizationInput = {
  /** Single trace (kept for backwards compatibility). */
  trace?: RequestTraceSnapshot;
  /** Aggregated traces from multiple requests. */
  traces?: RequestTraceSnapshot[];
  dataDependencies?: DataDependency[];
  slots?: SlotInput[];
  thresholds?: OptimizationThresholds;
};

export type TraceLoadResult = {
  snapshots: RequestTraceSnapshot[];
  files: string[];
  skippedLines: number;
};

/**
 * Load RequestTraceSnapshot JSONL files (one snapshot per line) from a
 * directory. Malformed lines are skipped and counted, never thrown.
 */
export function loadTraceSnapshots(dir: string): TraceLoadResult {
  const result: TraceLoadResult = { snapshots: [], files: [], skippedLines: 0 };
  if (!dir || !existsSync(dir)) return result;
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".jsonl"))
    .sort();
  for (const file of files) {
    const path = join(dir, file);
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    result.files.push(path);
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const snapshot = parseSnapshotLine(trimmed);
      if (snapshot) result.snapshots.push(snapshot);
      else result.skippedLines += 1;
    }
  }
  return result;
}

function parseSnapshotLine(line: string): RequestTraceSnapshot | undefined {
  try {
    const parsed = JSON.parse(line) as Partial<RequestTraceSnapshot>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.traceId !== "string" ||
      parsed.traceId.length === 0 ||
      !Array.isArray(parsed.nodes)
    ) {
      return undefined;
    }
    return {
      ...parsed,
      traceId: parsed.traceId,
      startedAtMs:
        typeof parsed.startedAtMs === "number" ? parsed.startedAtMs : 0,
      nodes: parsed.nodes as TraceNode[],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch {
    return undefined;
  }
}

export function createOptimizationFindings(
  input: OptimizationInput,
): OptimizationFinding[] {
  const traces = [
    ...(input.traces ?? []),
    ...(input.trace ? [input.trace] : []),
  ];
  const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  return [
    ...findDuplicateTraceAttribute(traces, "network", "url", "network"),
    ...findDuplicateTraceAttribute(traces, "data", "key", "data"),
    ...findWaterfallChains(traces, thresholds),
    ...findLowCacheHitRates(traces, thresholds),
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
  for (const severity of SEVERITY_ORDER) {
    const group = findings.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;
    lines.push(`## ${severity.toUpperCase()}`, "");
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
  return `${lines.join("\n")}\n`;
}

export const SEVERITY_ORDER: Array<OptimizationFinding["severity"]> = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export function formatLocation(location: OptimizationFinding["location"]) {
  const entries = Object.entries(location ?? {}).filter(
    ([, value]) => typeof value === "string" && value.length > 0,
  );
  if (entries.length === 0) return "unknown";
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

export function formatEvidence(
  evidence: OptimizationEvidence[] | undefined,
): string {
  if (!evidence || evidence.length === 0) return "none";
  return evidence
    .map((entry) => {
      const spans =
        entry.spanIds.length > 0 ? ` spans ${entry.spanIds.join(", ")}` : "";
      const measurements = entry.measurements
        ? ` (${Object.entries(entry.measurements)
            .map(([key, value]) => `${key}=${roundMs(value)}`)
            .join(", ")})`
        : "";
      return `trace ${entry.traceId}${spans}${measurements}`;
    })
    .join("; ");
}

function roundMs(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

type DuplicateOccurrence = { trace: RequestTraceSnapshot; nodes: TraceNode[] };

function findDuplicateTraceAttribute(
  traces: RequestTraceSnapshot[],
  kind: TraceNode["kind"],
  attribute: string,
  category: OptimizationFinding["category"],
) {
  const grouped = new Map<string, DuplicateOccurrence[]>();
  for (const trace of traces) {
    const byValue = new Map<string, TraceNode[]>();
    for (const node of trace.nodes) {
      if (node.kind !== kind) continue;
      const value = node.attributes[attribute];
      if (typeof value !== "string" || !value) continue;
      byValue.set(value, [...(byValue.get(value) ?? []), node]);
    }
    for (const [value, nodes] of byValue.entries()) {
      if (nodes.length < 2) continue;
      grouped.set(value, [...(grouped.get(value) ?? []), { trace, nodes }]);
    }
  }

  const findings: OptimizationFinding[] = [];
  for (const [value, occurrences] of grouped.entries()) {
    const totalSpans = occurrences.reduce(
      (sum, occurrence) => sum + occurrence.nodes.length,
      0,
    );
    const fragmentName =
      kind === "network"
        ? findOwningFragmentName(occurrences[0].trace, occurrences[0].nodes[0])
        : undefined;
    findings.push(
      OptimizationFindingSchema.parse({
        id: `duplicate-${kind}-${hashId(value)}`,
        severity: occurrences.length > 1 ? "high" : "medium",
        category,
        target: value,
        message:
          `${totalSpans} ${kind} spans used the same ${attribute}` +
          (occurrences.length > 1
            ? ` in ${occurrences.length} separate traces.`
            : "."),
        location:
          kind === "data"
            ? { dataKey: value }
            : fragmentName
              ? { fragmentName }
              : {},
        evidence: {
          traceId: occurrences[0].trace.traceId,
          spanIds: occurrences[0].nodes.map((node) => node.id),
        },
        traceEvidence: occurrences.map((occurrence) => ({
          traceId: occurrence.trace.traceId,
          spanIds: occurrence.nodes.map((node) => node.id),
        })),
        recommendation:
          kind === "data"
            ? "Route this data through @mvp/data request dedupe and cache policy."
            : "Route this endpoint through @mvp/request or @mvp/data so duplicate calls are deduped.",
      }),
    );
  }
  return findings;
}

type WaterfallOccurrence = {
  trace: RequestTraceSnapshot;
  first: TraceNode;
  second: TraceNode;
  gapMs: number;
};

function findWaterfallChains(
  traces: RequestTraceSnapshot[],
  thresholds: Required<OptimizationThresholds>,
) {
  const grouped = new Map<string, WaterfallOccurrence[]>();
  for (const trace of traces) {
    const networkSpans = trace.nodes
      .filter((node) => node.kind === "network" && node.endedAtMs !== undefined)
      .sort((a, b) => a.startedAtMs - b.startedAtMs);
    for (const first of networkSpans) {
      for (const second of networkSpans) {
        if (first.id === second.id) continue;
        const firstSlot = findOwningFragmentSpan(trace, first);
        const secondSlot = findOwningFragmentSpan(trace, second);
        if (!firstSlot || !secondSlot || firstSlot.id === secondSlot.id)
          continue;
        const firstEnd = first.endedAtMs ?? first.startedAtMs;
        if (second.startedAtMs < firstEnd) continue;
        const gapMs = second.startedAtMs - firstEnd;
        if (gapMs > thresholds.waterfallMaxGapMs) continue;
        if (slotsDependent(trace, firstSlot, secondSlot)) continue;
        const key = `${slotNameOf(firstSlot)}->${slotNameOf(secondSlot)}`;
        grouped.set(key, [
          ...(grouped.get(key) ?? []),
          { trace, first, second, gapMs },
        ]);
      }
    }
  }

  const findings: OptimizationFinding[] = [];
  for (const [key, occurrences] of grouped.entries()) {
    const traceIds = new Set(
      occurrences.map((occurrence) => occurrence.trace.traceId),
    );
    const sample = occurrences[0];
    const secondSlot = findOwningFragmentSpan(sample.trace, sample.second);
    findings.push(
      OptimizationFindingSchema.parse({
        id: `waterfall-${hashId(key)}`,
        severity: traceIds.size > 1 ? "high" : "medium",
        category: "network",
        target: key,
        message: `Slot "${key.split("->")[1]}" starts its network call only after unrelated slot "${key.split("->")[0]}" finishes; the requests serialize without a declared dependency.`,
        location: {
          slotName: secondSlot ? slotNameOf(secondSlot) : undefined,
          fragmentName: secondSlot ? fragmentNameOf(secondSlot) : undefined,
        },
        evidence: { pair: key, occurrences: occurrences.length },
        traceEvidence: occurrences.map((occurrence) => ({
          traceId: occurrence.trace.traceId,
          spanIds: [occurrence.first.id, occurrence.second.id],
          measurements: {
            gapMs: occurrence.gapMs,
            blockedByDurationMs:
              occurrence.first.durationMs ??
              (occurrence.first.endedAtMs ?? 0) - occurrence.first.startedAtMs,
          },
        })),
        recommendation:
          "Run these slots in parallel: remove the implicit serialization or declare dependsOn so the scheduler can plan the order explicitly.",
      }),
    );
  }
  return findings;
}

type CacheStats = {
  hits: number;
  misses: number;
  location: { dataKey?: string; fragmentName?: string };
  byTrace: Map<string, string[]>;
};

function findLowCacheHitRates(
  traces: RequestTraceSnapshot[],
  thresholds: Required<OptimizationThresholds>,
) {
  const stats = new Map<string, CacheStats>();
  const record = (
    key: string,
    location: CacheStats["location"],
    trace: RequestTraceSnapshot,
    node: TraceNode,
    hit: boolean,
  ) => {
    const entry = stats.get(key) ?? {
      hits: 0,
      misses: 0,
      location,
      byTrace: new Map<string, string[]>(),
    };
    if (hit) entry.hits += 1;
    else entry.misses += 1;
    entry.byTrace.set(trace.traceId, [
      ...(entry.byTrace.get(trace.traceId) ?? []),
      node.id,
    ]);
    stats.set(key, entry);
  };

  for (const trace of traces) {
    for (const node of trace.nodes) {
      if (node.kind === "data") {
        const dataKey = node.attributes.key;
        if (typeof dataKey !== "string" || !dataKey) continue;
        const source = node.attributes.source;
        if (source === "cache" || node.status === "cache")
          record(`data:${dataKey}`, { dataKey }, trace, node, true);
        else if (source === "loader")
          record(`data:${dataKey}`, { dataKey }, trace, node, false);
      } else if (node.kind === "fragment") {
        const strategy = node.attributes.strategy;
        if (strategy !== "cached-ssr" && strategy !== "isr") continue;
        const fragmentName = fragmentNameOf(node);
        if (!fragmentName) continue;
        const source = node.attributes.source;
        if (source === "cache" || node.status === "cache")
          record(
            `fragment:${fragmentName}`,
            { fragmentName },
            trace,
            node,
            true,
          );
        else if (source === "network")
          record(
            `fragment:${fragmentName}`,
            { fragmentName },
            trace,
            node,
            false,
          );
      }
    }
  }

  const findings: OptimizationFinding[] = [];
  for (const [key, entry] of stats.entries()) {
    const total = entry.hits + entry.misses;
    if (total < thresholds.cacheMinSamples) continue;
    const missRate = entry.misses / total;
    if (missRate <= thresholds.cacheMaxMissRate) continue;
    findings.push(
      OptimizationFindingSchema.parse({
        id: `cache-miss-${hashId(key)}`,
        severity: missRate >= 0.9 ? "high" : "medium",
        category: "cache",
        target: key,
        message: `Cache miss rate for ${key} is ${(missRate * 100).toFixed(0)}% (${entry.misses}/${total} lookups missed across ${entry.byTrace.size} trace(s)).`,
        location: entry.location,
        evidence: { hits: entry.hits, misses: entry.misses, missRate },
        traceEvidence: [...entry.byTrace.entries()].map(
          ([traceId, spanIds]) => ({
            traceId,
            spanIds,
            measurements: { hits: entry.hits, misses: entry.misses, missRate },
          }),
        ),
        recommendation:
          "Increase the cache TTL, align invalidation tags, or reduce cache-key cardinality (vary dimensions) so repeated requests hit the cache.",
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
        location: { dataKey: dependency.id },
        evidence: { dependency },
        recommendation:
          "Classify this data as build-time or isr if it does not require per-request state.",
      }),
    );
}

function findStaticSlotCandidates(
  slots: SlotInput[],
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
        location: {
          slotName: slot.name,
          fragmentName: slot.fragment,
          manifestPath: slot.manifestPath,
        },
        evidence: { fragment: slot.fragment, props: slot.props ?? {} },
        recommendation:
          "Change the slot strategy to static, isr, or cached-ssr if its content is deterministic.",
      }),
    );
}

function findOwningFragmentSpan(
  trace: RequestTraceSnapshot,
  node: TraceNode,
): TraceNode | undefined {
  let current: TraceNode | undefined = node;
  for (let depth = 0; depth < 16 && current; depth += 1) {
    if (current.kind === "fragment") return current;
    const parentId: string | undefined = current.parentId;
    current = parentId
      ? trace.nodes.find((candidate) => candidate.id === parentId)
      : undefined;
  }
  return undefined;
}

function findOwningFragmentName(
  trace: RequestTraceSnapshot,
  node: TraceNode,
): string | undefined {
  const owner = findOwningFragmentSpan(trace, node);
  return owner ? fragmentNameOf(owner) : undefined;
}

function fragmentNameOf(span: TraceNode): string | undefined {
  const fragment = span.attributes.fragment;
  if (typeof fragment === "string" && fragment) return fragment;
  return slotNameOf(span) || undefined;
}

function slotNameOf(span: TraceNode): string {
  const slot = span.attributes.slot;
  if (typeof slot === "string" && slot) return slot;
  return span.name.replace(/^slot:/, "");
}

function slotsDependent(
  trace: RequestTraceSnapshot,
  first: TraceNode,
  second: TraceNode,
): boolean {
  const firstName = slotNameOf(first);
  const secondName = slotNameOf(second);
  const dependsOn = (span: TraceNode) =>
    Array.isArray(span.attributes.dependsOn)
      ? (span.attributes.dependsOn as unknown[]).filter(
          (value): value is string => typeof value === "string",
        )
      : [];
  if (
    dependsOn(second).includes(firstName) ||
    dependsOn(first).includes(secondName)
  )
    return true;

  const refs = (span: TraceNode, name: string) =>
    new Set([span.id, `slot:${name}`, name]);
  const firstRefs = refs(first, firstName);
  const secondRefs = refs(second, secondName);
  return trace.edges.some(
    (edge) =>
      edge.type === "depends-on" &&
      ((firstRefs.has(edge.from) && secondRefs.has(edge.to)) ||
        (secondRefs.has(edge.from) && firstRefs.has(edge.to))),
  );
}

function hashId(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1)
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}
