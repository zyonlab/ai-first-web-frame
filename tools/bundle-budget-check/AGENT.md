# @mvp/bundle-budget-check — AGENT.md

## What this package is for

`@mvp/bundle-budget-check` is the `pnpm audit:bundle` gate (one of `pnpm
verify`'s six audits): it enforces the JS-weight ceilings each unit declares
in its own `src/budget.ts` (`fragments/<name>/src/budget.ts`,
`apps/<name>/src/budget.ts` — loaded by `tools/_shared/budgets.ts`) against
real measurements. Exceeding a ceiling is a hard `pnpm verify` failure.

**What it measures**, per unit class:

- **Pages** (scope `"page"`): first-load client JS from the real `next build`
  output — the union of every app route's files in
  `.next/app-build-manifest.json` plus `build-manifest.json`'s
  `rootMainFiles` (route handlers and `/_not-found` excluded), measured as
  **gzipped bytes** (wire weight, the scale of the 180KB default page
  budget). `.next` is generated: `pnpm verify` runs `pnpm build` before
  `audit:bundle`; a standalone run on an unbuilt tree FAILS loudly per page
  with a `"not built"` row (`actual: -1`) instead of passing on nothing, and
  a stale build (manifest files missing on disk) also fails with `-1`.
- **Fragments** (scope `"fragment"`): esbuild-bundle of the fragment's client
  entry (first match of `src/island.browser.ts` > `src/client.ts` >
  `src/island.tsx`), minified, with `react`, `react-dom`, and `@mvp/*` marked
  external — shared vendor is charged to the consuming page (D3 convention),
  only fragment-owned island/patch glue is charged to the fragment. Measured
  as **minified (pre-gzip) bytes**, the unit the fragment budget comments are
  written in. Fragments with no client entry are SSR-only: `actual: 0` with
  an explicit note (inline SSR `<script>` content is NOT counted — that is
  HTML weight).

**What it deliberately does not measure** (listed in the report's
`unmeasured` rows, never silently passed): fragment `cssBytes` (enforced by
`css-budget-check` / `pnpm audit:css` from source CSS), page `cssBytes` when
the build emits no extracted `.css` asset (this repo inlines page styles into
the HTML), `component`/`shell`-scope byte budgets (no measurement
implemented), and runtime-only metrics (`rscPayloadBytes`, TTFB/LCP/INP/CLS,
render/memory ceilings). A legacy root `budget.json`/`stats.json` pair is
still honored when present (`"(root)"` rows); the per-unit gate runs
regardless.

## Entry points

- `runBundleBudgetCheck(options?: CliOptions): Promise<BundleReport>` — the
  CLI/library entry (`options` defaults to `parseArgs(process.argv.slice(2))`
  from `tools/_shared/args.ts`). Loads unit budgets, measures per the rules
  above, writes `reports/bundle-report.json` + `.md`, and returns the report.
  Report status: `"fail"` if any check row fails, else `"pass"`
  (`statusFromCounts` — this audit emits no warn-level rows).
- `BundleReport` — `{ tool: "bundle-budget-check", status, checks, unmeasured, notes }`;
  each check row is `{ scope, unit, metric, actual, budget, status, measurement, note? }`
  where `actual: -1` means "artifact missing" (always a fail) and
  `measurement` states exactly what was measured so the report is auditable.

**Command (CLI)**
```
pnpm audit:bundle               # = pnpm --filter @mvp/bundle-budget-check start -- --ci
```
Flags: `--ci` (exit 1 on fail), `--warn-only` (never exit 1),
`--root <dir>`, `--scope component|fragment|page|shell` (limit to one scope),
`--budget <path>` / `--stats <path>` (legacy root file locations).

## Error taxonomy

- **Plain `Error`** (`"Unsupported scope: <scope>"`) — thrown before any
  measurement when `--scope` is not one of the four scopes.
- **Row-level failures, not exceptions**: a missing/stale `.next` build and
  an esbuild bundling error both become `status: "fail"` rows with
  `actual: -1` and an explanatory `note` — the audit completes and reports
  every unit rather than dying on the first broken one.
- Exit code (CLI): 1 only for `status === "fail"` with `--ci` and without
  `--warn-only`.

## Example

`runBundleBudgetCheck` measures the repo and writes `reports/` files, so the
executable example exercises the gate's pure semantics instead: the exported
report shape plus the shared status/exit-code math every audit uses
(imported relatively, exactly as `src/index.ts` does).

```ts
import type { BundleReport } from "@mvp/bundle-budget-check";
import { exitCodeFor, statusFromCounts } from "../../_shared/report";

const checks: BundleReport["checks"] = [
  {
    scope: "fragment",
    unit: "order-book",
    metric: "jsBytes",
    actual: 8_100,
    budget: 20_000,
    status: 8_100 <= 20_000 ? "pass" : "fail",
    measurement:
      "esbuild bundle of fragments/order-book/src/island.browser.ts (react/@mvp externals), minified bytes",
  },
  {
    // The "not built" contract: a page with a budget but no .next output
    // fails loudly with actual -1 instead of passing on nothing.
    scope: "page",
    unit: "page-home",
    metric: "jsBytes",
    actual: -1,
    budget: 180_000,
    status: "fail",
    measurement: "first-load JS from apps/page-home/.next",
    note: "page not built (.next missing): run `pnpm build` before audit:bundle",
  },
];
const report: BundleReport = {
  tool: "bundle-budget-check",
  status: statusFromCounts(checks.filter((c) => c.status === "fail").length),
  checks,
  unmeasured: [
    {
      unit: "order-book",
      metric: "cssBytes",
      reason: "enforced by css-budget-check (pnpm audit:css)",
    },
  ],
  notes: [],
};

if (report.status !== "fail") throw new Error("a -1 row must fail the audit");
if (exitCodeFor(report.status, true, false) !== 1)
  throw new Error("--ci turns fail into exit 1");
if (exitCodeFor(report.status, true, true) !== 0)
  throw new Error("--warn-only demotes the exit code, not the report status");
```

## Accept

```
pnpm build && pnpm audit:bundle
```
Expected: exit 0, report status `"pass"`; writes `reports/bundle-report.json`
and `reports/bundle-report.md` (check table + "Not measured by this audit"
table). Without a prior `pnpm build`, every page row fails with `actual: -1`
by design. Unit tests: `pnpm --filter @mvp/bundle-budget-check test`
(`src/index.test.ts` covers the legacy root contract, the fragment esbuild
gate incl. over-budget failure and SSR-only zero rows, and the page
`.next`-manifest gate incl. the loud not-built failure).
