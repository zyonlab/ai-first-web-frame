# Slot scheduling

The scheduler is the part with no Podium equivalent: slots and data dependencies form one
directed graph, which is executed in topological layers.

## Two kinds of edge

**`dependsOn`** — slot-to-slot. "Render `orderForm` after `accountBar`." Use it when one slot's
render genuinely needs another's outcome.

**`dataDependencies`** — slot-to-data. Names entries in the page's data-source registry that
must resolve before the slot runs. Two slots naming the same id share one resolution.

Both feed the same plan. Neither is a statement about cacheability — a slot with no `dependsOn`
is not therefore static, which is exactly the mistake the advisory optimizer currently makes
([F1](../known-limitations.md#f1)).

## Inspecting a plan without running it

```ts
import { createSlotDataExecutionPlan } from "@mvp/runtime";

const plan = createSlotDataExecutionPlan({ slots, dataDependencies });
// plan.levels : ScheduledNode[][]  — each level runs in parallel
// plan.hints  : SchedulerHint[]
```

Useful in a test or a lint rule: assert the plan has the shape you intended before shipping the
manifest.

## Hints

The planner reports three kinds of smell (`SchedulerHintKind`):

| Kind | Meaning |
| --- | --- |
| `long-serial-chain` | the graph has a deep path that will dominate latency |
| `unnecessary-barrier` | something forces a wait that the declared edges do not require |
| `duplicate-data-resolution` | the same data id resolved more than once |

Hints are advisory: they travel in `execution.hints` and in the optimizer report. They do not
fail a build.

## Execution semantics

1. Levels run in parallel; level *n+1* starts when level *n* has settled.
2. Each slot gets its own timeout — `slot.timeoutMs`, or the page default. On expiry the slot
   becomes its declared fallback; the rest of the page is unaffected.
3. If a node fails, everything downstream of it is **not attempted** and reports
   `status: "skipped-dependency"` — distinct from "tried and failed".
4. `execution.health` rolls up: any failed **required** slot ⇒ `unhealthy`; any other failure ⇒
   `degraded`; otherwise `ok`.

Failure is always local. There is no path by which one slot's exception aborts the response.

## Streaming

```ts
const { slots, result } = streamFragmentSlots(options);
// slots.<name> : Promise<FragmentRenderResponse>  — resolves when ITS level settles
// result       : Promise<FragmentSlotsExecution>  — resolves when everything settles
```

Every per-slot promise **resolves** — it never rejects. A failed or skipped slot resolves to the
same fallback response the barrier API would have produced, so a `<Suspense>` boundary never
needs a try/catch.

This is what lets a page flush its shell and its fast slots before a slow slot finishes, instead
of holding the whole response for the slowest one.

## Timeouts

`withTimeout(promise, ms, onTimeout?)` is the primitive. It is deliberately not built on
`AbortSignal.timeout`, which is missing in some test DOM environments — the portable fallback is
why the gateway's timeout helper exists as `createUpstreamTimeout()`.
