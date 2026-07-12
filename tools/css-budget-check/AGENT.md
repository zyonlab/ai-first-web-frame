# @mvp/css-budget-check — AGENT.md

## What this package is for

`@mvp/css-budget-check` is the `pnpm audit:css` gate (one of `pnpm verify`'s
six audits): the CSS-weight and CSS-hygiene counterpart to
`bundle-budget-check`. Two layers in one report:

- **Per-unit `cssBytes` gates** — for every unit declaring `cssBytes` in its
  own `src/budget.ts` (loaded by `tools/_shared/budgets.ts`), the unit's own
  source `.css` files are minified (lightningcss when installed, with a regex
  fallback) and summed as **pre-gzip bytes** — the scale the declared
  fragment ceilings (6–10KB) are written in. `actual > budget` is a hard
  fail. A unit with a ceiling but no `.css` files on disk gets an explicit
  zero-actual row noting that inline `<style>`/CSS-in-JS is **not counted** —
  said out loud instead of silently passing.
- **Global hygiene metrics** — across every `.css` file under `packages/` and
  `fragments/`: `totalCssBytes` (minified), `unusedCssBytes` (rule bodies
  whose selector class names appear nowhere in the scanned `packages/` +
  `fragments/` source text — a heuristic), `duplicatedRules` (identical
  selector+body), `globalSelectors` (`html`/`body`/`:root`/`*`/bare element
  selectors), `importantCount`, and `cssModuleUsage` (share of
  `.module.css` files). These become failures only when a root `budget.json`
  declares ceilings for them (`{ css: { totalCssBytes, ... } }` or flat keys;
  `cssBytes` is accepted as an alias for `totalCssBytes`); without that file
  they are informational. Individual `duplicated-rule` / `global-selector`
  findings are listed with file + value either way.

**What it deliberately does not measure**: built/emitted CSS (this is a
source-side gate; page-level built CSS is `bundle-budget-check`'s job when
the Next build emits any), inline/injected styles, and CSS under `apps/`
outside a unit's own directory tree.

## Entry points

- `runCssBudgetCheck(options?: CliOptions): Promise<CssReport>` — the
  CLI/library entry (`options` defaults to `parseArgs(process.argv.slice(2))`
  from `tools/_shared/args.ts`). Scans, gates, writes
  `reports/css-report.json` + `.md`, returns the report. Status:
  `statusFromCounts(<exceeded root ceilings> + <failing unit rows>)` —
  `"fail"` or `"pass"`, no warn tier.
- `CssReport` — `{ tool: "css-budget-check", status, metrics, budget,
  checks, findings }`; each per-unit row is `{ scope, unit, metric: "cssBytes",
  actual, budget, status, note? }`, each finding
  `{ type: "duplicated-rule" | "global-selector", file, value }`.

**Command (CLI)**
```
pnpm audit:css                  # = pnpm --filter @mvp/css-budget-check start -- --ci
```
Flags: `--ci` (exit 1 on fail), `--warn-only` (never exit 1),
`--root <dir>`, `--css <path>` (limit the global metrics scan to one file).

## Error taxonomy

- No custom error types. A missing root `budget.json` means an empty global
  budget (metrics stay informational); a missing `lightningcss` silently uses
  the regex minifier fallback — both are expected states, not errors.
- Raw `fs` errors (unreadable css/budget file) and a broken unit `budget.ts`
  (via `loadUnitBudgets`' dynamic import) propagate and fail the run loudly.
- Exit code (CLI): 1 only for `status === "fail"` with `--ci` and without
  `--warn-only`. Budget failure recovery is shrinking/splitting the CSS, not
  raising the ceiling (`CLAUDE.md` hard rule).

## Example

`runCssBudgetCheck` scans the repo and writes `reports/` files, so the
executable example exercises the gate's pure row/status semantics on the
exported report shape, with the same shared status math the tool uses.

```ts
import type { CssReport } from "@mvp/css-budget-check";
import { statusFromCounts } from "../../_shared/report";

// Per-unit rows exactly as runCssBudgetCheck emits them: actual = minified
// pre-gzip bytes of the unit's own source .css files.
const makeRow = (
  unit: string,
  actual: number,
  budget: number,
  note?: string,
): CssReport["checks"][number] => ({
  scope: "fragment",
  unit,
  metric: "cssBytes",
  actual,
  budget,
  status: actual <= budget ? "pass" : "fail",
  note,
});

const checks = [
  makeRow("order-book", 5_400, 8_000, "2 css file(s), minified bytes"),
  // Ceiling declared but no .css on disk: explicit zero row, not a silent pass.
  makeRow(
    "promotion-banner",
    0,
    6_000,
    "no .css files in unit dir; inline/injected styles are not counted",
  ),
  makeRow("order-form", 9_200, 8_000), // over ceiling -> fail
];
if (checks[2].status !== "fail") throw new Error("over-ceiling row must fail");

const report: CssReport = {
  tool: "css-budget-check",
  status: statusFromCounts(checks.filter((c) => c.status === "fail").length),
  metrics: {
    totalCssBytes: 14_600,
    unusedCssBytes: 0,
    duplicatedRules: 1,
    globalSelectors: 0,
    importantCount: 0,
    cssModuleUsage: { moduleFiles: 3, totalFiles: 4, ratio: 0.75 },
  },
  budget: {}, // no root budget.json: global metrics stay informational
  checks,
  findings: [
    { type: "duplicated-rule", file: "fragments/order-form/src/styles.css", value: ".row{gap:4px}" },
  ],
};

if (report.status !== "fail")
  throw new Error("one failing unit row must fail the whole audit");
// With an empty root budget, duplicatedRules/globalSelectors alone never fail:
if (statusFromCounts(0) !== "pass") throw new Error("no ceilings -> informational");
```

## Accept

```
pnpm audit:css
```
Expected: exit 0 with status `"pass"`; writes `reports/css-report.json` and
`reports/css-report.md` (per-unit table from each unit's `src/budget.ts` +
global metrics table). Unit tests:
`pnpm --filter @mvp/css-budget-check test` (`src/index.test.ts` covers
root-budget pass/fail, duplicated/global/`!important` detection, the stable
report shape, and the per-unit ceiling gate incl. the explicit css-less-unit
row).
