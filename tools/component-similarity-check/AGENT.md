# @mvp/component-similarity-check — AGENT.md

## What this package is for

`@mvp/component-similarity-check` is the `pnpm audit:similarity` gate (one of
`pnpm verify`'s six audits): it fingerprints every component source file and
fails when two of them are near-duplicates, forcing reuse of the existing
component instead of landing a copy (the `CLAUDE.md` failure-recovery rule:
"reuse the flagged existing component").

**What it scans** (component sources only): `packages/ui/**/*.tsx` and
`fragments/**/src/**/*.tsx`, excluding `*.test.tsx` (and the standard
`walkFiles` skips: `node_modules`, `dist`, `dist-browser`, `.next`,
`coverage`). It deliberately does **not** scan `apps/**`, `domains/**`, other
`packages/*`, or plain `.ts` files — it is a UI-component duplication gate,
not a general clone detector.

**How it scores**: each file becomes a `ComponentFingerprint` — `name` (from
a sibling `metadata.ts` when present, else the filename), `category`
(`"ui"` / `"fragment"`), extracted `*Props` member names, non-relative import
specifiers, unique source tokens, `className` tokens, and JSX tag shape. Each
pair is compared per dimension (Levenshtein-normalized name similarity;
Jaccard for the set dimensions; category equality) and combined with fixed
weights — `name 0.16, category 0.10, props 0.16, dependencies 0.10,
sourceTokens 0.20, cssClasses 0.12, jsxShape 0.16` (sums to 1). Any pair
scoring `>= threshold` (default **0.82**, override with `--threshold <n>`) is
a match, and **any match fails the audit** (`statusFromCounts(matches.length)`
— there is no warn tier).

## Entry points

- `runSimilarityCheck(options?: CliOptions): SimilarityReport` — the
  CLI/library entry (`options` defaults to `parseArgs(process.argv.slice(2))`
  from `tools/_shared/args.ts`). Discovers + fingerprints components,
  compares all pairs, writes `reports/similarity-report.json` + `.md`, and
  returns the report.
- `SimilarityReport` — `{ tool: "component-similarity-check", status, threshold,
  checkedFiles: string[], matches: Array<{ left, right, score, dimensions }> }`;
  `matches` is sorted by descending score, `score`/`dimensions` values are
  rounded to 4 decimals, and file paths are repo-relative posix.

**Command (CLI)**
```
pnpm audit:similarity           # = pnpm --filter @mvp/component-similarity-check start -- --ci
```
Flags: `--ci` (exit 1 on fail), `--warn-only` (never exit 1),
`--root <dir>`, `--threshold <0..1>` (non-numeric values fall back to 0.82).

## Error taxonomy

- No custom error types and no thrown validation errors: a missing
  `metadata.ts` falls back to filename/path inference; duplication is
  reported in-band as `matches` + `status: "fail"`.
- Raw `fs` errors (unreadable source file) propagate and fail the run loudly.
- Exit code (CLI): 1 only for `status === "fail"` with `--ci` and without
  `--warn-only`. Recovery is never "raise the threshold": reuse or extend the
  flagged existing component.

## Example

`runSimilarityCheck` scans the repo and writes `reports/` files, so the
executable example reproduces the scoring core with the same shared math the
tool imports (`tools/_shared/text.ts`), on two toy fingerprints.

```ts
import type { SimilarityReport } from "@mvp/component-similarity-check";
import { jaccard, normalizedNameSimilarity, uniqueTokens } from "../../_shared/text";

const WEIGHTS = {
  name: 0.16,
  category: 0.1,
  props: 0.16,
  dependencies: 0.1,
  sourceTokens: 0.2,
  cssClasses: 0.12,
  jsxShape: 0.16,
} as const;

type Toy = {
  name: string;
  category: string;
  props: string[];
  dependencies: string[];
  source: string;
  cssClasses: string[];
  jsxShape: string[];
};
const score = (a: Toy, b: Toy) =>
  normalizedNameSimilarity(a.name, b.name) * WEIGHTS.name +
  (a.category === b.category ? 1 : 0) * WEIGHTS.category +
  jaccard(a.props, b.props) * WEIGHTS.props +
  jaccard(a.dependencies, b.dependencies) * WEIGHTS.dependencies +
  jaccard(uniqueTokens(a.source), uniqueTokens(b.source)) * WEIGHTS.sourceTokens +
  jaccard(a.cssClasses, b.cssClasses) * WEIGHTS.cssClasses +
  jaccard(a.jsxShape, b.jsxShape) * WEIGHTS.jsxShape;

const card: Toy = {
  name: "ProductCard",
  category: "ui",
  props: ["title", "price"],
  dependencies: ["@mvp/ui"],
  source: `export function ProductCard({ title, price }) { return <article className="card">{title}</article>; }`,
  cssClasses: ["card"],
  jsxShape: ["article"],
};
// A rename-only copy: identical on every dimension except the name.
const copy: Toy = { ...card, name: "ItemCard" };

if (Number(score(card, card).toFixed(4)) !== 1)
  throw new Error("identical components must score exactly 1 (weights sum to 1)");
const copyScore = score(card, copy);
if (copyScore < 0.82)
  throw new Error("a rename-only duplicate must clear the default threshold");

// Any match at/above threshold fails the audit — there is no warn tier.
const status: SimilarityReport["status"] = copyScore >= 0.82 ? "fail" : "pass";
if (status !== "fail") throw new Error("duplicate must fail");

// Unrelated shapes stay far below the threshold.
const table: Toy = {
  name: "OrderTable",
  category: "fragment",
  props: ["rows", "onSort"],
  dependencies: ["@mvp/contracts"],
  source: `export function OrderTable({ rows }) { return <table className="grid"><tbody /></table>; }`,
  cssClasses: ["grid"],
  jsxShape: ["table", "tbody"],
};
if (score(card, table) >= 0.82) throw new Error("unrelated components must pass");
```

## Accept

```
pnpm audit:similarity
```
Expected: exit 0 with status `"pass"` and `matches: []`; writes
`reports/similarity-report.json` and `reports/similarity-report.md`. On a
fail, the report lists the offending pair with per-dimension scores — reuse
the flagged existing component instead of adding the near-duplicate. Unit
tests: `pnpm --filter @mvp/component-similarity-check test`
(`src/index.test.ts` covers detection of highly similar components,
non-flagging of unrelated ones, and the stable report shape).
