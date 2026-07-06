# 08 — Observability + Trace Visualization UI

> Anchored to the [spine](README.md). This document owns the detail behind spine **§10
> (Observability + trace UI upgrade)** and depends on the framework map in §2. It is written
> to be read after the spine. Where a detail here conflicts with the spine, the spine wins
> until amended there.

## 0. Problem statement

Today the trace surface on the home and product pages is a single `<pre>{traceLog}</pre>`
dump (see `apps/page-home/app/page.tsx:82-85` and
`apps/page-product/app/product/[id]/page.tsx:133`). `traceLog` is the output of
`RequestTrace.toDependencyGraphLog()` — a flat, line-per-node text rendering. It proves the
trace *exists*, but it is useless as a **performance-analysis tool**: you cannot see start
offsets, span overlap, the critical path, cache hit/miss, subscription lifetime, budget
overruns, or the optimizer's findings, and you cannot click through to the manifest slot that
caused a waterfall.

This document specifies the upgrade: a real **trace waterfall UI** — a Gantt timeline +
dependency graph + budget/hint overlays — fed by the data we already emit
(`RequestTrace.toJSON()`, `/metrics`, and `createOptimizationFindings`). It doubles as the
demo's proof that the framework's optimization loop is real (§4 walkthrough).

The trace UI consumes only **already-existing contracts**; it introduces no new span kinds or
metric shapes. Everything below projects from:

- `RequestTraceSnapshot` (`packages/observability/src/index.ts`) — `nodes: TraceNode[]`,
  `edges: TraceEdge[]`, `startedAtMs` / `endedAtMs` / `durationMs`.
- `MetricsSnapshot` (`packages/observability/src/metrics.ts`) — histograms
  (`http_request_duration_seconds`, `web_vitals_*`) + counters/gauges from `/metrics`.
- `OptimizationFinding[]` (`packages/optimizer/src/index.ts` +
  `@mvp/contracts` `OptimizationFindingSchema`) — with `location` (slotName / fragmentName /
  dataKey / manifestPath / filePath) and `traceEvidence` (traceId + spanIds + measurements).
- `SchedulerHint[]` (`packages/runtime/src/index.ts`) — `long-serial-chain`,
  `unnecessary-barrier`, `duplicate-data-resolution`, carried in the scheduler span's
  `attributes.schedulerHints` and returned from `executeFragmentSlots`.

---

## 1. Data model — what the UI consumes

### 1.1 Source shapes (recap, do not redefine)

| Source | Shape | Key fields the UI reads |
| --- | --- | --- |
| Trace | `RequestTraceSnapshot` | `traceId`, `startedAtMs`, `endedAtMs`, `nodes[]`, `edges[]` |
| Span | `TraceNode` | `id`, `name`, `kind`, `parentId`, `startedAtMs`, `endedAtMs`, `durationMs`, `status`, `attributes` |
| Edge | `TraceEdge` | `from`, `to`, `type` (`parent` \| `depends-on` \| `calls` \| `uses-cache`) |
| Metrics | `HistogramMetricSnapshot` | `name`, `buckets[]`, `values[].bucketCounts/sum/count`, `labels` |
| Finding | `OptimizationFinding` | `severity`, `category`, `target`, `message`, `recommendation`, `location`, `traceEvidence[]` |
| Hint | `SchedulerHint` | `kind`, `slots[]`, `data[]`, `message` |

Span `kind` is the fixed enum
`request | scheduler | fragment | network | cache | static | data | custom`. Span `status` is
`ok | error | timeout | fallback | cache | static`. **The UI never invents lanes or colors
outside these enums.** Cache and realtime distinctions are derived from `kind` + `status` +
`attributes` (see §1.3), not new kinds.

Attributes the runtime already sets, that the view model relies on
(`packages/runtime/src/index.ts`):

- scheduler span: `slots`, `levels`, `schedulerHints`, `health`, `failedRequiredSlots`.
- fragment (slot) span: `slot`, `fragment`, `strategy`, `channel`, `dependsOn`,
  `dataDependencies`, `required`, and on completion `source` (`static|cache|network|fallback`),
  `cacheKey`.
- network span: `serviceUrl`, `version`, `timeoutMs`, `fallback`.
- cache span: `cacheKey` (status `cache` = hit; absence of a cache span before a network span
  under the same slot = miss).
- data span: `data`, `dependsOn`, and — when present — `source` (`cache|loader`) used by the
  optimizer's cache-miss rule.

### 1.2 Normalized view model (TypeScript draft)

The UI never renders raw snapshots; a pure projector `buildTraceView(snapshot, metrics,
findings, budgets)` produces a normalized, layout-ready view model. This function is the unit
under test (§6). Draft:

```ts
// packages/observability/src/traceView.ts (new; pure, no DOM, browser-safe)

export type LaneId =
  | "request"
  | "scheduler"
  | "slot"        // fragment spans
  | "data"        // @mvp/data reads
  | "network"     // outbound fragment HTTP
  | "cache"       // cache lookups (hit/miss)
  | "realtime";   // subscription lifetime spans

export interface Lane {
  id: LaneId;
  label: string;
  order: number;              // fixed top→bottom: scheduler→slot→data→network→cache→realtime
  bars: SpanBar[];
}

export interface SpanBar {
  spanId: string;             // = TraceNode.id
  lane: LaneId;
  name: string;
  kind: TraceNode["kind"];
  status: TraceNode["status"];
  startOffsetMs: number;      // startedAtMs - snapshot.startedAtMs  (>= 0)
  durationMs: number;         // endedAtMs - startedAtMs; open spans clamp to snapshot end
  depth: number;              // nesting depth via parentId chain, for indentation
  onCriticalPath: boolean;    // see §1.4
  // classification derived from kind+status+attributes (never a new kind):
  cache?: "hit" | "miss";     // slot with a cache span/status = hit; slot that fell to network = miss
  realtime?: boolean;         // subscription span (attributes.source === "subscription" or channel set)
  fallback?: boolean;         // status === "fallback"
  slot?: string;              // attributes.slot
  fragment?: string;          // attributes.fragment
  manifestPath?: string;      // resolved from finding.location.manifestPath when linked
  attributes: Record<string, unknown>;
  // overlays attached to this bar:
  hints: HintMarker[];        // scheduler hints / optimizer findings anchored to this span
}

export interface Edge {
  from: string;               // spanId
  to: string;                 // spanId
  type: TraceEdge["type"];
  // graph-view classification:
  isDependsOn: boolean;       // type === "depends-on"
  onCycle: boolean;           // part of a dependency cycle (graph view highlight)
  isWaterfall: boolean;       // implicated by a waterfall finding (undeclared serialization)
}

export interface HintMarker {
  id: string;                 // finding.id or `${hint.kind}:${hint.slots.join(",")}`
  origin: "scheduler-hint" | "optimizer-finding";
  severity: OptimizationFinding["severity"] | "info";
  category?: OptimizationFinding["category"];
  kind?: SchedulerHint["kind"];
  message: string;
  recommendation?: string;
  // deep-link target so a click jumps to the exact manifest/component:
  location?: {
    slotName?: string;
    fragmentName?: string;
    dataKey?: string;
    manifestPath?: string;    // e.g. apps/page-trade/src/manifest.slots.json
    filePath?: string;
  };
  spanIds: string[];          // spans this marker annotates (from traceEvidence)
  measurements?: Record<string, number>; // gapMs, blockedByDurationMs, missRate, ...
}

export interface BudgetOverlay {
  scope: "page" | "fragment";
  name: string;               // page-home / order-book / ...
  metric: "jsBytes" | "cssBytes" | "rscPayloadBytes"
        | "maxNetworkRequests" | "maxTTFBMs" | "maxLCPMs" | "maxINPMs" | "maxCLS";
  budget: number;
  observed: number;           // from /metrics or reports/*-report.json
  overBudget: boolean;        // observed > budget
  overByPct: number;
  reportLink?: string;        // reports/bundle-report.md#<name> or css-report.md#<name>
}

export interface TraceView {
  traceId: string;
  requestId?: string;
  totalDurationMs: number;    // snapshot end - start; the timeline width basis
  lanes: Lane[];              // ordered; empty lanes omitted
  edges: Edge[];
  criticalPath: string[];     // ordered spanIds
  hints: HintMarker[];        // flat list (also attached per-bar)
  budgets: BudgetOverlay[];
  health?: "ok" | "degraded" | "unhealthy"; // from scheduler span attributes
}

export function buildTraceView(input: {
  snapshot: RequestTraceSnapshot;
  metrics?: MetricsSnapshot;
  findings?: OptimizationFinding[];
  schedulerHints?: SchedulerHint[];   // optional; also recoverable from scheduler span attrs
  budgets?: Array<{ scope: "page" | "fragment"; name: string;
                    limits: Record<string, number> }>;
}): TraceView;
```

### 1.3 Lane assignment rule

Lane is derived from `kind` (+ `status`/`attributes`), deterministically:

| span kind | status/attr | Lane | Notes |
| --- | --- | --- | --- |
| `request` | — | `request` | root row, the full-width bar |
| `scheduler` | — | `scheduler` | `runtime.fetchFragmentSlots` |
| `fragment` | any | `slot` | one bar per mounted slot |
| `data` | — | `data` | `@mvp/data` reads; `cache?` from `attributes.source` |
| `network` | — | `network` | outbound `/render` HTTP; `fallback?` from status |
| `cache` | `status: "cache"` | `cache` | a cache span = a **hit** for its parent slot |
| any | `attributes.source === "subscription"` or realtime channel | `realtime` | subscription lifetime |

**Cache hit vs miss (derived, no new kind):** a slot bar is `cache: "hit"` when a child span
of kind `cache` exists (or the slot span `status === "cache"`), and `cache: "miss"` when the
slot resolved via a `network` child with `source === "network"` under a cacheable strategy
(`cached-ssr` | `isr`). This mirrors exactly the optimizer's `findLowCacheHitRates` logic so
the UI and the audit agree.

### 1.4 Critical path

`criticalPath` is the longest-duration chain of spans from the root `request` span to any leaf,
walking `parent` + `depends-on` edges, maximizing summed `durationMs` (open spans clamped to
snapshot end). Bars on it get `onCriticalPath: true` and are drawn with the accent treatment
(§2.4). This is the single most important addition over the `<pre>` dump: it tells the reader
*which* serial chain actually bounds the page, which is exactly what the `long-serial-chain`
scheduler hint and the `waterfall` finding are trying to shorten.

---

## 2. View spec + wireframes

Four coordinated views, tab-switched, sharing one selected `traceId`:

1. **Waterfall (Gantt)** — default.
2. **Dependency graph**.
3. **Findings & hints list** (drill-down).
4. **Budgets** (overlay + standalone table).

### 2.1 Waterfall (Gantt) — lanes + bars

Lanes are stacked top→bottom in fixed order: `scheduler → slot → data → network → cache →
realtime` (the `request` root spans the header ruler). Each bar starts at
`startOffsetMs / totalDurationMs` and is `durationMs / totalDurationMs` wide. Nesting is shown
by `depth` indentation within a lane.

```
 trace 7f3a…  request 41.8ms   health: degraded            [Waterfall] Graph  Findings  Budgets
 ────────────────────────────────────────────────────────────────────────────────────────────
 t(ms)        0        10        20        30        40   │ zoom [–][▮▮▮▮───][+]   ⟳ live: last 5
 ┌──────────┬──────────────────────────────────────────────────────────────────────────────┐
 scheduler  │ (= fetchFragmentSlots ══════════════════════════════════════════════ =)       │
 ──────────┼──────────────────────────────────────────────────────────────────────────────┤
 slot       │ [static-editorial ▓]                                                          │
            │        [promotion ▓▓▓▓▓▓▓▓▓]  ✦cache-hit                                       │
            │                        ⚠[recommendations ▒▒▒▒▒▒▒▒▒▒▒▒▒▒]  ← critical path      │
 ──────────┼──────────────────────────────────────────────────────────────────────────────┤
 data       │        (home-featured-content ▓▓)  dedupe:2 reads→1                           │
 ──────────┼──────────────────────────────────────────────────────────────────────────────┤
 network    │        [promotion /render ░░]                                                 │
            │                        [recommendations /render ▒▒▒▒▒▒▒▒▒▒▒▒]  ← critical path │
 ──────────┼──────────────────────────────────────────────────────────────────────────────┤
 cache      │        ✓ promotion (hit, key=…)                                               │
 ──────────┼──────────────────────────────────────────────────────────────────────────────┤
 realtime   │ ┈┈┈ recommendation-heat subscription (open, 3 msgs) ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈  │
 └──────────┴──────────────────────────────────────────────────────────────────────────────┘
 ⚠ waterfall: "recommendations" starts only after "promotion" finishes (gap 4ms, no dependsOn)
   → fix in apps/page-home/src/manifest.slots.json   [jump]      severity: high
```

Legend / conventions:
- `═` request/scheduler root, `▓` served (ok), `▒` critical-path bar (accent), `░` network,
  `┈` realtime subscription (dashed = long-lived, not a point-in-time span).
- `✦`/`✓` cache-hit marker on the slot and in the cache lane; a miss shows `✗` + the network
  bar it fell through to.
- `⚠` inline hint anchor; clicking opens the finding and offers `[jump]` to
  `location.manifestPath` / `filePath`.
- The `← critical path` bars are tinted with the accent color; everything else is muted.

### 2.2 Cache and realtime lanes — color/legend

Colors come from `@mvp/design-system` tokens (spine §11) so the tool themes with the app; no
hard-coded hex. Semantic mapping:

| Marker | Token role | Meaning |
| --- | --- | --- |
| cache **hit** | `--color-success` | slot resolved from `cache` span / `status: cache` |
| cache **miss** | `--color-warning` | cacheable slot fell through to `network` |
| realtime subscription | `--color-info` (dashed) | open-ended lifetime, patch-only island |
| fallback / error / timeout | `--color-danger` | `status ∈ {fallback,error,timeout}` |
| ok (default) | `--color-fg-muted` | normal served span |
| critical path | `--color-accent` | on the bounding chain |

A persistent legend row sits under the tab bar. Realtime bars are explicitly **not** normal
spans: they represent subscription lifetime and message count (`attributes` msg counters),
drawn dashed to signal "still open", never contributing to the request critical path.

### 2.3 Budget overlay

For each `BudgetOverlay` whose metric maps to a horizontal axis (bytes/time), draw a dashed
**budget line** across the relevant lane; a bar/summary exceeding it renders in
`--color-danger` with the `overByPct`. Sources:

- Page/fragment size + web-vital budgets from `src/budget.ts` (e.g.
  `apps/page-home/src/budget.ts`: `jsBytes`, `cssBytes`, `rscPayloadBytes`, `maxTTFBMs`,
  `maxLCPMs`, `maxINPMs`, `maxCLS`, `maxNetworkRequests`).
- Observed values from `/metrics` (`http_request_duration_seconds`, `web_vitals_lcp/inp/cls/ttfb`)
  and from `reports/bundle-report.json` / `reports/css-report.json`.
- `reportLink` deep-links each overrun to `reports/bundle-report.md` /
  `reports/css-report.md` so the reader crosses from "the trace is slow" to "the bundle is the
  reason".

```
 Budgets (page-home)                                observed / budget
 jsBytes           ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮·······│ 172k / 180k   ok
 cssBytes          ▮▮▮▮·····················│  1.3k / 50k    ok
 LCP (ms)          ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮│ 2610 / 2500  OVER +4.4%  → reports/bundle-report.md#page-home [open]
 networkRequests   ▮▮▮▮▮▮▮·················· │   7 / 20      ok
```

### 2.4 Scheduler hints + optimizer findings inline

Every `HintMarker` is anchored to the span(s) in its `spanIds` (from `traceEvidence` for
findings, or matched by `slots`/`data` name for `SchedulerHint`s). It renders as a `⚠` on the
bar and, when expanded, shows `message`, `measurements` (e.g. `gapMs`, `missRate`,
`blockedByDurationMs`), `recommendation`, and a `[jump]` button. `[jump]` resolves, in order:
`location.manifestPath` → `location.filePath` → the fragment's `src/manifest.ts`, using the
slot/fragment name. The three `SchedulerHint.kind`s and the optimizer categories map to a
badge:

| Origin | kind/category | Badge | Typical fix (recommendation carried through) |
| --- | --- | --- | --- |
| scheduler hint | `long-serial-chain` | "serial chain" | parallelize / drop a `dependsOn` |
| scheduler hint | `unnecessary-barrier` | "barrier" | reorder slots so a slot isn't gated by unrelated levels |
| scheduler hint | `duplicate-data-resolution` | "dup data" | keep one shared data node (already deduped; confirms intent) |
| finding | `network` (waterfall) | "waterfall" | remove implicit serialization or declare `dependsOn` |
| finding | `network`/`data` (duplicate) | "dup request" | route via `@mvp/request` / `@mvp/data` |
| finding | `cache` | "cache miss" | raise TTL / align tags / reduce key cardinality |
| finding | `ssg`/`isr` | "over-dynamic" | change slot `strategy` to `static`/`isr`/`cached-ssr` |

### 2.5 Dependency graph view

Nodes = slot + data spans; edges = `depends-on` (solid) and `parent` (faint). A **cycle** is
highlighted in `--color-danger` (mirrors the runtime's `dependency cycle detected` throw), and
edges implicated by a waterfall finding are highlighted as **undeclared serialization** (drawn
in `--color-warning`, since these are pairs that ran serially *without* a declared edge — the
opposite failure from a cycle). Layout is layered by the scheduler's execution `levels` (left→right
by level index), so the graph visually is the execution plan.

```
 Dependency graph (by execution level)          ○ data   □ slot   ⇒ depends-on   ⋯ parent
 level 0            level 1                 level 2
 ○ featured ─────⇒ □ promotion
                   □ static-editorial
                   □ recommendations   ⋯⋯⋯ (waterfall: ran after promotion, no edge)  ⚠
```

### 2.6 Interactions

- **Hover span** → tooltip with `name`, `kind`, `status`, `startOffsetMs`, `durationMs`, and
  the full `attributes` (slot/fragment/strategy/cacheKey/…).
- **Click span / hint `[jump]`** → deep-link to the component or manifest slot: resolve
  `location.manifestPath` (e.g. `apps/page-trade/src/manifest.slots.json`) or the fragment
  under `fragments/<name>/`. In-app this scrolls to the mounted DOM node
  (`data-fragment="<name>"`); in a hosted inspector it links to the source path.
- **Timeline zoom** → `[–]/[+]` and drag-select a time window; bars re-scale against the
  zoomed `totalDurationMs`.
- **Switch by `traceId`** → a trace picker (most-recent-first) over the loaded snapshots.
- **Live refresh** → poll the newest N snapshots from `reports/traces/*.jsonl` (or the SSE
  endpoint, §3.3) and prepend; re-uses the `@mvp/data` `subscribeData` island pattern already
  used by `RealtimeInsights` (value-changed callbacks only, no full re-render).

---

## 3. Landing form — fragment vs island

The trace UI is itself a framework unit, so it must live somewhere in the framework map (§2).
Two shapes; recommendation below.

### 3.1 Option A — dedicated deployable fragment `trace-inspector` (recommended)

Ship it as a normal SSR fragment via the standard lifecycle (root `CLAUDE.md` §Fragment
lifecycle): `create-component TraceInspector --type fragment` → implement/TDD →
`register-fragment` (own port, canary) → `mount-slot` into a dev/ops surface → verify →
promote. It exposes the standard `/health`, `/manifest`, `/assets`, `/render`, `/metrics`
routes, SSR-renders the waterfall from a snapshot, and hydrates one island (via
`@mvp/trade-client`, spine §4/§11) for zoom/hover/graph/live-refresh.

Trade-offs:
- **+** Independently deployable and versioned; can be mounted on `/trade` behind a dev flag or
  hosted as a standalone `/inspector` ops page without touching the trade pages.
- **+** Gets its own budget, `/metrics`, contract, tests — it is dogfood: the tool that proves
  the optimization loop is itself produced by the loop.
- **+** Reusable across home/product/trade (all three currently `<pre>`-dump); one component
  replaces three ad-hoc panels.
- **−** More moving parts (a port, a Docker service, registry entry) than an inline island.

### 3.2 Option B — trade-page island only

Render it inside the trade page as a `@mvp/trade-client` island reading the current request's
`RequestTraceSnapshot` directly. Simpler, no new service, but not reusable, not independently
deployable, and it competes for the trade page's JS budget.

### 3.3 Recommendation

**Fragment (`trace-inspector`), hydrated as one island**, hosted on a dev/ops route and
optionally mounted on `/trade` behind a flag. This matches the spine's "dedicated
island/fragment" language (§10) and the per-component-deploy story (§9). It reads two inputs:

1. **Traces** — the `FileTraceExporter` output at `reports/traces/<service>-<date>.jsonl`
   (`packages/observability/src/traceExport.ts`). The fragment loads snapshots with the
   optimizer's existing `loadTraceSnapshots(dir)` (skips malformed lines, already tested), so
   SSR first paint renders the newest trace with zero client JS. For live mode it tails the
   directory and streams new lines over SSE; the browser island patches in new traces via the
   `subscribeData` pattern.
2. **Metrics** — a GET to each unit's `/metrics` (`toPrometheusText()` / `toJSON()`), parsed
   into `HistogramMetricSnapshot`s for the budget overlay.

SSR-first posture (spine §13): the server renders the full waterfall for the selected trace as
static HTML (readable with no JS); the island only adds zoom, hover tooltips, the graph view,
and live refresh. Findings are computed server-side by calling
`createOptimizationFindings({ traces, slots, dataDependencies })` so the SSR HTML already
carries the `⚠` markers.

**Budget note:** this is a tooling page, so its JS budget is allowed to be **wider** than a
data panel (it ships graph layout + zoom), but the allowance must be **declared explicitly** in
its `src/budget.ts` and justified in [09-shared-dependencies.md](09-shared-dependencies.md),
not left implicit. It still shares React/chart runtime through `@mvp/trade-client` (one chunk,
not re-bundled) and its CSS through `@mvp/design-system`. Keep the SSR path budget-free
(no-JS-readable) so the tool never regresses the very budgets it reports.

---

## 4. Optimization closed-loop walkthrough (demo highlight)

End-to-end: **discover a waterfall → the trace UI highlights it → follow the recommendation to
edit the manifest → re-sample and compare before/after.** This is the demo's proof that the
loop is real.

**Step 0 — baseline.** On the trade page, `market-header` (needs candle bootstrap) and
`order-form` (needs account/margin) each make a `/render` network call. They have no declared
relationship, but in the baseline plan they land in adjacent execution levels and serialize:
`order-form`'s network call starts right after `market-header`'s finishes, gap < 50ms.

**Step 1 — sample traces.** Run the trade page a few times; the `FileTraceExporter` appends
snapshots to `reports/traces/page-trade-<date>.jsonl`.

**Step 2 — the trace UI highlights it.** `trace-inspector` loads the snapshots, builds the
view, and the waterfall shows the two `network` bars end-to-start on the **critical path**. The
optimizer's `findWaterfallChains` produces a `network`/"waterfall" finding:

```
 ⚠ waterfall  severity: high
 "order-form" starts its network call only after unrelated slot "market-header"
 finishes; the requests serialize without a declared dependency.
 measurements: gapMs=4.2, blockedByDurationMs=18.7
 → location: slotName=order-form, manifestPath=apps/page-trade/src/manifest.slots.json  [jump]
 recommendation: Run these slots in parallel: remove the implicit serialization or
 declare dependsOn so the scheduler can plan the order explicitly.
```

**Step 3 — act on the recommendation.** `[jump]` opens
`apps/page-trade/src/manifest.slots.json`. Per the recommendation, make the intended ordering
explicit and let the scheduler parallelize the rest — edit the slot via the script, never by
hand (root `CLAUDE.md`):

```
pnpm exec tsx scripts/mount-slot.mts --page page-trade --slot orderForm \
  --fragment order-form --strategy dynamic-ssr --channel canary --timeout-ms 200
# (adjust dependsOn so only the genuine dependency is declared; the two slots
#  that were serializing by accident now share an execution level and run in parallel)
```

Wire the slot into the page's `src/fragmentSlots.ts` fetch list and tests as usual.

**Step 4 — re-sample and compare.** Re-run the page, appending new snapshots. In
`trace-inspector`, use the trace picker to put the **before** and **after** traces side by side
(diff mode): the two `network` bars now overlap in a single level, the critical path shortens
by ~`blockedByDurationMs`, and the waterfall finding disappears. If the corresponding
`unnecessary-barrier` / `long-serial-chain` scheduler hint was firing, it clears too, and
`levels` drops by one. `pnpm verify` re-runs the optimization audit with zero waterfall
findings — the loop closes.

The same loop applies to the other rules: a `cache`/"cache miss" finding → raise TTL / align
tags in the slot's `cachePolicy` → re-sample and watch the cache lane flip from `✗` to `✓`; an
`ssg`/"over-dynamic" finding → change slot `strategy` → the slot moves from the `network` lane
to a `static`/`cache` served bar.

---

## 5. Migrating off the `<pre>` dump

Three call sites render `<pre>{traceLog}</pre>` today. Migration is incremental and keeps the
no-JS-readable posture.

1. **Keep `traceLog` as a fallback, add the view model.** In each page's `src/fragmentSlots.ts`
   (`fetchHomeFragmentSlots`, the product equivalent, and the new trade one), keep returning
   `traceLog` but also return the raw `snapshot = trace.toJSON()` (and the already-returned
   `scheduler.hints`). No behavior change; the `<pre>` still works.
2. **Replace the `<pre>` section with the trace-inspector fragment/island.** In
   `apps/page-home/app/page.tsx:82-85` (and the product page line 133, and the new trade page),
   swap:
   ```tsx
   <section data-request-trace="home">
     <h2>Request trace</h2>
     <pre>{fragmentHtml.traceLog}</pre>
   </section>
   ```
   for a mounted `trace-inspector` slot (SSR waterfall for the current `snapshot`, hydrated for
   interaction). The server-rendered waterfall stays keyboard- and no-JS-readable, so the
   accessibility/no-JS guarantees the `<pre>` gave are preserved.
3. **Retain `toDependencyGraphLog()` for logs/tests only.** It stays useful as a compact text
   assertion in unit tests and container logs; it is simply no longer the *UI*. The page tests
   that currently assert on `traceLog` (`apps/page-home/tests/page-home.test.ts`,
   `apps/page-product/tests/page-product.test.ts`) keep asserting the log string; new tests
   assert the view model (§6).
4. **Order of rollout:** trade page first (it is new; land the fragment there), then retrofit
   home and product by replacing their `<pre>` sections with the same mounted slot. One
   component, three call sites deleted.

---

## 6. Tests to write (future)

All on the pure projector so no DOM/browser is needed (Vitest, root config):

1. **View-model projection from a synthetic trace.** Given a hand-built `RequestTraceSnapshot`
   (root request + scheduler + two slots + one data + two network + one cache span), assert
   `buildTraceView` yields the expected lanes, bar count per lane, and `startOffsetMs` /
   `durationMs` normalized against `snapshot.startedAtMs`. Assert empty lanes are omitted and
   lane order is fixed.
2. **Lane classification.** A cacheable slot with a `cache` child → `cache: "hit"`; the same
   slot resolving via a `network` child with `source:"network"` → `cache: "miss"`; a span with
   `attributes.source === "subscription"` → `realtime: true`; `status:"fallback"` →
   `fallback: true`. Must agree with the optimizer's `findLowCacheHitRates` on identical input.
3. **Critical-path computation.** Given overlapping vs serial spans, assert `criticalPath` is
   the longest-duration root-to-leaf chain and that exactly those bars get `onCriticalPath`.
   Include an open (un-ended) span to verify clamping to snapshot end.
4. **Hint/finding anchoring.** Feed `createOptimizationFindings` output (waterfall + cache
   findings) and `SchedulerHint`s; assert each `HintMarker` attaches to the spans in its
   `traceEvidence.spanIds` (or matched slot/data names) and carries `location`, `measurements`,
   and `recommendation` through unchanged. Assert `[jump]` target resolves
   `manifestPath` → `filePath` → fragment fallback in that order.
5. **Budget judgement.** Given a `src/budget.ts` limit and an observed value from a
   `MetricsSnapshot` histogram, assert `overBudget` / `overByPct` and that `reportLink` points
   at the right `reports/*-report.md`. Include an exactly-at-budget boundary case
   (`observed === budget` ⇒ not over).
6. **Dependency-graph edges.** Assert `depends-on` edges are marked `isDependsOn`, a
   constructed cycle sets `onCycle` on its edges, and a waterfall-finding pair sets
   `isWaterfall` on the (absent-but-implied) edge.
7. **Diff mode.** Given before/after snapshots of the §4 walkthrough, assert the after view has
   fewer critical-path bars and no waterfall `HintMarker`.

---

## 7. Coordination notes (for spine + sibling docs)

The following changes must be reflected in other docs — flagged here, to be made by their
owners, not in this file:

- **[02-component-architecture.md] ownership matrix:** add the `trace-inspector` **fragment**
  (SSR + one island) as a new deployable unit — its render/hydration contract, props
  (`{ traceDir?, traceId?, live? }`), `/manifest`, budget entry, and the `data-fragment=
  "trace-inspector"` mount node. It owns no market data; it reads traces/metrics/reports.
- **[09-shared-dependencies.md] shared deps + budget attribution:** record that
  `trace-inspector`'s island hydrates through **`@mvp/trade-client`** (React + chart/graph
  adapter, one shared chunk, not re-bundled) and styles through **`@mvp/design-system`**
  (semantic color tokens used by the lane legend, §2.2). Document its **wider-than-panel JS
  budget** allowance and the justification, and that the SSR path stays no-JS-readable so it
  doesn't regress the budgets it reports.
- **[03-data-architecture.md]:** note the trace/metrics read path (`reports/traces/*.jsonl` via
  `loadTraceSnapshots`, `/metrics` GET) and the live-refresh SSE source as request-time/near-
  realtime dependencies of the inspector; realtime lane relies on subscription spans emitted by
  `@mvp/data` `subscribeData`.
- **[07-deployment-examples.md]:** `trace-inspector` is a clean second candidate for the
  single-component deploy runbook (own port, canary → promote), since it is orthogonal to the
  trade data path.
- **Spine §10:** already anchors this doc; no change needed beyond confirming the "dedicated
  island/fragment" wording maps to the fragment recommendation in §3.3 here.
- **New file to be created by the implementer (not in this doc):**
  `packages/observability/src/traceView.ts` (the pure projector + types in §1.2) and
  `packages/observability/src/traceView.test.ts` (the §6 tests), exported from
  `packages/observability/src/index.ts`.
```