# @mvp/optimizer — AGENT.md

## What this package is for

`@mvp/optimizer` turns `@mvp/observability` trace snapshots (and, optionally,
declared data dependencies / slot definitions from `@mvp/contracts`) into
`OptimizationFinding[]` — schema-validated, actionable findings such as
duplicate network/data calls, serialized waterfalls that could run in
parallel, low cache hit rates, and slots/data eligible for static or ISR
rendering. It is read-only analysis: it never mutates a manifest or registry,
only reports. `pnpm audit:optimizer` (part of `pnpm verify`) runs this package
against `reports/traces/*.jsonl` produced during e2e/smoke runs.

## Entry points

- `loadTraceSnapshots(dir: string): TraceLoadResult` — reads every `*.jsonl`
  file in `dir` (one `RequestTraceSnapshot` per line, as written by
  `@mvp/observability`'s `createFileTraceExporter`), skipping malformed lines
  instead of throwing. Returns `{ snapshots: RequestTraceSnapshot[], files: string[], skippedLines: number }`.
  Use to load `reports/traces/` before calling `createOptimizationFindings`.
- `createOptimizationFindings(input: OptimizationInput): OptimizationFinding[]`
  — the main analysis entry point.
  `OptimizationInput = { trace?, traces?, dataDependencies?, slots?, thresholds? }`.
  Runs all five rules (duplicate network calls, duplicate data reads,
  waterfall chains, low cache hit rate, static-candidate data/slots) and
  returns their combined, `OptimizationFindingSchema`-validated findings.
- `createOptimizationMarkdown(findings: OptimizationFinding[]): string` —
  renders findings grouped by severity (`critical` > `high` > `medium` >
  `low` > `info`) as a Markdown report; this is what `audit:optimizer` writes
  to `reports/`.
- `SEVERITY_ORDER: OptimizationFinding["severity"][]` — the canonical severity
  ranking (`["critical","high","medium","low","info"]`), exported so other
  tooling sorts findings consistently.
- `formatLocation(location)` / `formatEvidence(evidence)` — the same
  human-readable formatters `createOptimizationMarkdown` uses internally;
  exported for custom report renderers.

## Error taxonomy

- **`ZodError`** (from `@mvp/contracts`'s `OptimizationFindingSchema.parse`
  inside every rule function) — would only surface if a rule constructs a
  finding that violates the schema (e.g. an empty `id`/`message`/
  `recommendation`); this indicates a bug in this package's rule logic, not a
  caller error, since findings are always built from fixed templates.
- `loadTraceSnapshots` and its internal `parseSnapshotLine` never throw —
  unreadable files are skipped (not added to `files`), and malformed JSON
  lines or lines missing `traceId`/`nodes` increment `skippedLines` instead of
  raising. There is no way to detect *which* lines were skipped beyond the
  count; treat a nonzero `skippedLines` as a signal to inspect the exporter
  that produced the file, not as an exception to catch.
- `createOptimizationFindings` and `createOptimizationMarkdown` do not throw
  for empty/missing input — an empty `traces`/`slots`/`dataDependencies` list
  simply yields an empty findings array (and `createOptimizationMarkdown`
  returns the literal string `"# Optimization Findings\n\nNo findings.\n"`).

## Example

```ts
import {
  loadTraceSnapshots,
  createOptimizationFindings,
  createOptimizationMarkdown,
} from "@mvp/optimizer";

const { snapshots, skippedLines } = loadTraceSnapshots("reports/traces");
if (skippedLines > 0) {
  console.warn(`skipped ${skippedLines} malformed trace lines`);
}

const findings = createOptimizationFindings({
  traces: snapshots,
  thresholds: { cacheMaxMissRate: 0.4 },
});

console.log(createOptimizationMarkdown(findings));
for (const finding of findings) {
  if (finding.severity === "critical" || finding.severity === "high") {
    console.error(`${finding.category}: ${finding.message}`);
  }
}
```

## Accept

```
pnpm --filter @mvp/optimizer test
```
Expected: Vitest exits 0. `packages/optimizer/src/index.test.ts` covers each
rule (duplicate attribute detection, waterfall gap threshold, cache miss-rate
threshold, static data/slot candidates) plus the JSONL loader's tolerance for
malformed lines. To exercise it against real trace data end to end:
`pnpm audit:optimizer` — writes `reports/optimization-findings.md` and exits 0
when no `critical` findings are present.
