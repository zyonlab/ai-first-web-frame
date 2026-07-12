# @mvp/optimization-audit — AGENT.md

## What this package is for

`@mvp/optimization-audit` is the `pnpm audit:optimizer` gate (one of `pnpm
verify`'s six audits): it discovers every page's mounted slots, loads any
runtime trace snapshots from `reports/traces/`, feeds both to
`@mvp/optimizer`'s `createOptimizationFindings` rule engine (duplicate calls,
waterfalls, low cache hit rate, static-rendering candidates — see
`packages/optimizer/AGENT.md` for the rules), and writes the findings report.
This package owns the discovery/reporting shell; the analysis rules live in
`@mvp/optimizer`.

What it measures: slot candidates from every
`apps/page-*/src/manifest.slots.json` (falling back to a legacy
`apps/page-*/src/manifest.ts` only when the JSON file is absent in that app)
plus `RequestTraceSnapshot` JSONL files under `<root>/reports/traces`. What it
deliberately does not: with no trace files the trace-based rules are skipped
and the report says so (`traces.note = "no runtime traces found; trace-based
rules skipped"`) rather than passing silently on nothing; it never renders
pages or measures runtime timings itself (that is `verify:runtime`).

## Entry points

- `runOptimizationAudit(options?: CliOptions, config?: OptimizationAuditConfig): OptimizationAuditReport`
  — the CLI/library entry (`options` defaults to
  `parseArgs(process.argv.slice(2))`; `config.traceDir` defaults to
  `<root>/reports/traces`). Writes `reports/optimization-findings.json` +
  `.md` and returns the report. Status math: any `critical` finding →
  `"fail"`, any finding at all → `"warn"`, else `"pass"`
  (`statusFromCounts(criticalCount, findingCount)`).
- `findPageManifestSlots(root: string): SlotCandidate[]` — filesystem
  discovery of `{ name, fragment, strategy?, dependsOn?, manifestPath? }` per
  mounted slot across all page apps.
- `parseSlotsFromJsonSource(source: string): SlotCandidate[]` — pure parser
  for `manifest.slots.json` content (accepts a bare array or `{ slots: [...] }`;
  malformed JSON or entries without string `name`+`fragment` yield `[]`/get
  dropped).
- `parseSlotsFromManifestSource(source: string): SlotCandidate[]` — pure
  regex parser for the legacy TS `manifest.ts` shape (`slots: [...]` up to
  `budget:`).
- `OptimizationAuditReport` — `{ tool: "optimization-audit", status, findings,
  traces: { dir, filesRead, snapshotCount, skippedLines, note? } }`.

**Command (CLI)**
```
pnpm audit:optimizer            # = pnpm --filter @mvp/optimization-audit start -- --ci
```
Flags (shared `tools/_shared/args.ts` set): `--ci` (exit 1 on fail),
`--warn-only` (never exit 1), `--root <dir>`.

## Error taxonomy

- No custom error types. The parsers are total: malformed JSON/TS source
  returns `[]`, malformed slot entries are dropped — never thrown.
- Malformed JSONL lines in a trace file are counted in
  `traces.skippedLines` (via `@mvp/optimizer`'s `loadTraceSnapshots`), not
  thrown.
- Raw `fs` errors (unreadable manifest file) propagate and fail the run
  loudly.
- Exit code (CLI): 1 only for `status === "fail"` with `--ci` and without
  `--warn-only`; findings of severity below `critical` only ever produce
  `"warn"` (exit 0).

## Example

```ts
import { parseSlotsFromJsonSource } from "@mvp/optimization-audit";
import { createOptimizationFindings } from "@mvp/optimizer";

// The pure core: manifest.slots.json content -> slot candidates.
const slots = parseSlotsFromJsonSource(
  JSON.stringify([
    {
      name: "recommendations",
      fragment: "recommendation-widget",
      strategy: "dynamic-ssr",
      dependsOn: [],
    },
    { name: "broken-entry-without-fragment" }, // dropped: no `fragment`
  ]),
);
if (slots.length !== 1) throw new Error("malformed entries must be dropped");
if (slots[0].fragment !== "recommendation-widget") throw new Error("fragment");
if (slots[0].strategy !== "dynamic-ssr") throw new Error("strategy");

if (parseSlotsFromJsonSource("not json").length !== 0)
  throw new Error("malformed JSON must yield [] instead of throwing");

// The same slot list feeds @mvp/optimizer's rule engine (here with no traces,
// as in a fresh checkout: only the static slot/data rules can fire).
const findings = createOptimizationFindings({ slots, traces: [] });
if (!Array.isArray(findings)) throw new Error("findings array");
for (const finding of findings) {
  if (typeof finding.severity !== "string" || typeof finding.category !== "string")
    throw new Error("finding shape");
}
```

## Accept

```
pnpm audit:optimizer
```
Expected: exit 0 with status `"pass"` or `"warn"` (findings are advisory
unless `critical`); writes `reports/optimization-findings.json` and
`reports/optimization-findings.md`. On a repo with no `reports/traces/`
directory, the report's `traces.note` says trace-based rules were skipped.
Unit tests: `pnpm --filter @mvp/optimization-audit test`
(`src/index.test.ts` covers both parsers, slot discovery, and status math).
