# tools/runtime-gate — AGENT.md

## What this package is for

`tools/runtime-gate` is the runtime/visual contract evaluator behind
`pnpm verify:runtime` (docs/AI_NATIVE_DEVX.md §6, Phase 4) — the plane
`pnpm verify` can't see. Every trade-demo defect of the motivating cycle
(fragment CSS not delivered, React #418, the `ticker.ETH` symbol-switch
crash, the 490px layout void) passed the unit gate green and was only visible
in a running browser; this module turns those defect classes into machine
checks. It is **not a workspace package** (no `package.json`) — one PURE
module (observations in → verdict out); the Playwright driver
(`scripts/verify-runtime.mts`) collects the observations, and
`scripts/deploy-affected.mts --runtime` runs the gate against every affected
page. This is a **separate gate** from `pnpm verify` (which stays unit-plane
and needs no browser/stack) — run it post-deploy/smoke after
`docker compose up`.

## Entry points

- `evaluateRuntime(obs: RuntimeObservation, thresholds: RuntimeThresholds = DEFAULT_THRESHOLDS): { checks: RuntimeCheck[]; ok: boolean }`
  — pure. Emits five checks, plus one optional interaction check:
  - `hydration-clean` — zero entries in `pageErrors` + `consoleErrors`.
  - `no-react-418` — none of the errors match the React #418 / hydration
    class (`/#418|Minified React error #418|hydrat/i`).
  - `assets-delivered` — no `staticRequests` entry with status ≥ 400 (the
    CSS-not-delivered / chunk-404 class).
  - `layout-fit` — no pane strands its content above a void larger than
    `maxPaneVoidPx` (`areaHeight − contentHeight`; the 490px header-void
    class). Pane source: only the trade page emits `[data-area]` grid cells;
    every composed page emits `[data-fragment]` on each fragment's root, so
    that is the generic fallback plane — `RuntimeObservation.paneSource`
    (`"data-area" | "data-fragment" | "none"`) records which one measured
    (when omitted it is inferred: non-empty panes → `"data-area"`, for older
    fixtures). No panes at all still passes but says so in the detail.
  - `no-horizontal-overflow` — `horizontalOverflowPx <= maxHorizontalOverflowPx`.
  - `interaction:<name>` — only when `obs.interaction` is present (e.g.
    `orderbook→order-form-price`, the signature shared-store flow).
    `skipped: true` means the contract doesn't apply to this page (no
    order-book present) and counts as ok — reported explicitly so "not
    applicable" is distinguishable from "not collected".
  `ok` is the AND of all checks.
- `DEFAULT_THRESHOLDS: RuntimeThresholds` —
  `{ maxPaneVoidPx: 48, maxHorizontalOverflowPx: 2 }`.
- Types: `RuntimeObservation` (`pageErrors`, `consoleErrors`,
  `staticRequests: { url, status }[]`, `panes: { area, areaHeight,
  contentHeight }[]`, `paneSource?`, `horizontalOverflowPx`, `interaction?`),
  `RuntimeCheck` (`{ name, ok, detail?, skipped? }`), `RuntimeThresholds`,
  `PaneObservation`, `PaneSource`, `StaticRequest`.

**Command (CLI driver)**
```
pnpm verify:runtime                                   # default: composed trade page
pnpm verify:runtime --url http://localhost:4103/trade/BTC
pnpm verify:runtime --json
```
Requires the target to be up (`docker compose up` or a running page service);
exits non-zero on any failed check.

## Error taxonomy

- `evaluateRuntime` never throws: every defect is an in-band
  `{ ok: false, detail }` check row (details carry the worst offender, e.g.
  `"worst pane void 490px @ header (source: data-area, max 48)"`).
- The driver (`scripts/verify-runtime.mts`) owns operational failures
  (unreachable URL, Playwright errors) and pre-filters benign noise out of
  `pageErrors`/`consoleErrors` before they reach the evaluator.

## Example

Imports are written for where `docs:test` executes this snippet
(`tools/runtime-gate/.docs-test-tmp/`).

```ts
import { DEFAULT_THRESHOLDS, evaluateRuntime, type RuntimeObservation } from "../src/checks";

if (DEFAULT_THRESHOLDS.maxPaneVoidPx !== 48) throw new Error("void threshold");

const healthy: RuntimeObservation = {
  pageErrors: [],
  consoleErrors: [],
  staticRequests: [{ url: "/_next/static/chunks/main.js", status: 200 }],
  panes: [{ area: "order-book", areaHeight: 520, contentHeight: 512 }],
  paneSource: "data-fragment", // the generic non-trade-page measurement plane
  horizontalOverflowPx: 0,
  // Explicit "not applicable": this page composes no order-book.
  interaction: { name: "orderbook→order-form-price", ok: false, skipped: true },
};
const good = evaluateRuntime(healthy);
if (!good.ok) throw new Error("healthy page must pass");
const names = good.checks.map((c) => c.name).join();
if (
  names !==
  "hydration-clean,no-react-418,assets-delivered,layout-fit,no-horizontal-overflow,interaction:orderbook→order-form-price"
)
  throw new Error(`check set: ${names}`);
if (!good.checks[5].skipped) throw new Error("skipped contract counts as ok, visibly");

// The defect classes the gate exists for, in one observation.
const broken = evaluateRuntime({
  ...healthy,
  consoleErrors: ["Minified React error #418"],
  staticRequests: [{ url: "/_next/static/css/app.css", status: 404 }],
  panes: [{ area: "header", areaHeight: 540, contentHeight: 50 }], // 490px void
  paneSource: "data-area",
  horizontalOverflowPx: 12,
});
if (broken.ok) throw new Error("must fail");
const byName = new Map(broken.checks.map((c) => [c.name, c]));
if (byName.get("no-react-418")?.ok !== false) throw new Error("hydration mismatch class");
if (byName.get("assets-delivered")?.ok !== false) throw new Error("css-404 class");
if (byName.get("layout-fit")?.ok !== false) throw new Error("490px-void class");
if (!byName.get("layout-fit")?.detail?.includes("490px"))
  throw new Error("detail names the worst void");
if (byName.get("no-horizontal-overflow")?.ok !== false) throw new Error("overflow class");
```

## Accept

```
pnpm exec vitest run tools/runtime-gate
```
Expected: Vitest exits 0. `src/checks.test.ts` covers each defect class, the
`[data-fragment]` fallback plane, and the explicit interaction skip. For the
live gate: `pnpm verify:runtime` against the running compose stack — exit 0
with every check `OK`/`SKIP`.
