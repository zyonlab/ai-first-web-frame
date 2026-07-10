# @mvp/runtime — AGENT.md

## What this package is for

`@mvp/runtime` is the page-side composition engine: given a page's slot
definitions and a `FragmentRegistry`, it resolves each slot's fragment
(HTTP fetch, TTL cache, or static HTML), schedules slots and their declared
data dependencies into dependency-ordered execution levels, applies per-slot
timeouts, and degrades individual slot failures into fallback HTML instead of
failing the whole page. It never talks to the network directly — the caller
supplies `fetchImpl` and an optional `RuntimeTrace`-shaped tracer (structurally
compatible with `@mvp/observability`'s `RequestTrace`). Use this package inside
a page's server component / route handler, not inside a fragment itself.

## Entry points

- `executeFragmentSlots(options: FetchFragmentSlotsOptions): Promise<FragmentSlotsExecution>`
  — the main entry point. Runs the full scheduler: resolves `dataDependencies`
  and `slots` into levels, executes each level in parallel, skips nodes whose
  dependencies failed, and returns
  `{ slots: Record<string, FragmentSlotResult>, data: Record<string, DataResolutionResult>, health: "ok" | "degraded" | "unhealthy", hints: SchedulerHint[] }`.
  Use when composing a page that has both fragment slots and declared data
  dependencies.
- `fetchFragmentSlots(options: FetchFragmentSlotsOptions): Promise<Record<string, FragmentSlotResult>>`
  — thin wrapper around `executeFragmentSlots` that returns only `.slots`; use
  when a page has no `dataDependencies` and only needs the slot results.
- `fetchFragmentSlot(input): Promise<FragmentSlotResult>` — resolves a single
  slot (static HTML, TTL cache lookup, or `fetchFragment` over HTTP) against
  one registry entry; called internally by the scheduler but exported for
  single-slot use (e.g. an isolated route handler).
- `resolveFragment(registry: FragmentRegistry, name: string, versionOrChannel: string): { version, serviceUrl, manifestUrl } | null`
  — looks up a fragment by channel name (`"stable" | "canary" | "preview"`),
  exact version, or pinned version string; returns `null` if not registered.
- `createSlotDataExecutionPlan(input): SlotDataExecutionPlan` — builds the
  dependency-ordered `levels` (and `hints`, see below) from `slots` +
  `dataDependencies` without executing anything; use to validate/preview a
  page's scheduling plan (e.g. in a lint rule or doc generator).
- `createFallbackResponse(fragmentName, version?, reason?): FragmentRenderResponse`
  — builds the same fallback shape the scheduler returns automatically; use
  when hand-writing a degraded response outside the scheduler.

## Error taxonomy

`@mvp/runtime` favors degrade-to-fallback over throwing; most fragment
failures never surface as exceptions. It only throws in these cases:

- **`Error("no resolveData resolver configured for data dependency \"<id>\"")`**
  — a slot or dependency declares `dataDependencies`/`dependsOn` on a data id
  but `options.resolveData` was not provided. Caught internally per-node and
  recorded as `{ status: "error" }` in the returned `data` map — it does not
  propagate out of `executeFragmentSlots`, but will if you call
  `createSlotDataExecutionPlan` incorrectly outside the scheduler.
- **`Error("duplicate data dependency \"<id>\"")`** /
  **`Error("duplicate fragment slot \"<name>\"")`** — thrown synchronously by
  `createSlotDataExecutionPlan` (and thus `executeFragmentSlots`) when two
  entries share a key; this is a caller bug in the slot/data list, not a
  runtime condition, and is not caught.
- **`Error("data dependency \"<id>\" depends on missing data \"<parent>\"")`** /
  **`Error("fragment slot \"<name>\" depends on missing slot \"<dependency>\"")`**
  — thrown synchronously when `dependsOn`/`dataDependencies` reference an id
  that isn't in the plan; also a caller bug, not caught.
- **`Error("dependency cycle detected: <keys>")`** — thrown synchronously when
  the dependency graph cannot be topologically sorted.
- **`Error("required fragment slots failed: <names>")`** — thrown by
  `executeFragmentSlots` only when `onRequiredFailure: "throw"` is passed
  (default is `"fallback"`, which instead sets `health: "unhealthy"` and
  returns normally). Use `"throw"` when the page itself should 500 rather than
  render a degraded shell.

Individual fragment HTTP failures (non-2xx, timeout, network error) never
throw — they resolve to a `FragmentSlotResult` with `status: "fallback"` and
`source: "fallback"`, produced by `createFallbackResponse`.

## Example

```ts
import { executeFragmentSlots, type FragmentSlotDefinition } from "@mvp/runtime";
import type { FragmentRegistry, RequestContext } from "@mvp/contracts";
import { createRequestContext } from "@mvp/request-context";

const registry: FragmentRegistry = {
  fragments: {
    "price-panel": {
      stable: {
        version: "0.1.0",
        serviceUrl: "http://localhost:4203",
        manifestUrl: "http://localhost:4203/manifest",
      },
    },
  },
};

const slots: FragmentSlotDefinition[] = [
  { name: "pricePanel", fragment: "price-panel", channel: "stable", timeoutMs: 200 },
];

const ctx: RequestContext = createRequestContext();

const execution = await executeFragmentSlots({
  slots,
  registry,
  ctx,
  timeoutMs: 200,
});

console.log(execution.health); // "ok" | "degraded" | "unhealthy"
console.log(execution.slots.pricePanel.status); // "ok" | "fallback" | "skipped-dependency"
```

## Accept

```
pnpm --filter @mvp/runtime test
```
Expected: Vitest exits 0. `packages/runtime/src/index.test.ts` covers scheduler
ordering, timeout fallback, static/cache sourcing, and the `health` rollup for
the scenarios above.
