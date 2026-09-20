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
- `streamFragmentSlots(options: FetchFragmentSlotsOptions): FragmentSlotStreamHandle`
  — the non-blocking counterpart to `executeFragmentSlots` (which is now built
  on top of it: `executeFragmentSlots` just does
  `return streamFragmentSlots(options).result`). Kicks off the same DAG-aware
  scheduler but returns IMMEDIATELY, before level 0 has even started, exposing
  one promise per declared slot plus one aggregate promise. Use inside a
  server component that wants to start streaming the static shell and
  individual `<Suspense>` boundaries before every fragment has settled,
  instead of blocking on one barrier for the whole page.

`streamFragmentSlots` returns a `FragmentSlotStreamHandle`:
```ts
export type FragmentSlotStreamHandle = {
  // One promise per declared slot (keyed by slot name), each resolving the
  // moment THAT SLOT'S OWN DAG level finishes — independent of slots
  // scheduled in later levels. Always resolves, never rejects: a failed or
  // skipped slot resolves to the same fallback `FragmentRenderResponse`
  // `executeFragmentSlots` has always produced.
  slots: Record<string, Promise<FragmentRenderResponse>>;
  // The full aggregate — byte-identical in shape to what
  // `executeFragmentSlots` returns — settling only once every level
  // (including the slowest slot and every data dependency) is done.
  result: Promise<FragmentSlotsExecution>;
};
```

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

## Example (barrier API)

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

## Example (streaming API)

Same inputs as above, but `streamFragmentSlots` returns before any fetch
settles, so the per-slot promise can be handed to `<FragmentSlotStream>`
(`@mvp/runtime/react`, below) inside its own `<Suspense>` boundary instead of
blocking page render on `execution`:

```ts no-run
import { streamFragmentSlots } from "@mvp/runtime";

const stream = streamFragmentSlots({ slots, registry, ctx, timeoutMs: 200 });

// Returns immediately — nothing has been awaited yet.
console.log(stream.slots.pricePanel); // Promise<FragmentRenderResponse>
console.log(stream.result); // Promise<FragmentSlotsExecution>

const pricePanel = await stream.slots.pricePanel; // settles as soon as its own level finishes
const execution = await stream.result; // settles once every level/data dependency is done
```

## `@mvp/runtime/react` — `<FragmentSlot>` / `<FragmentSlotStream>`

Published from the `./react` subpath (`packages/runtime/src/react.tsx`), not
the package root, so the Node-safe scheduler core above never pulls React
into non-React consumers (fastify fragment services, lifecycle scripts).
Both components render through the same rule: HTML present ->
`dangerouslySetInnerHTML`; otherwise -> `fallback` — so the two produce
byte-identical markup regardless of which one a page uses.

- `FragmentSlot(props: FragmentSlotProps): ReactNode` — synchronous, renders
  an already-resolved result. `FragmentSlotProps` is one of:
  - `{ name: string; execution: FragmentSlotsExecution | Record<string, FragmentSlotResult>; fallback: ReactNode }`
    — look up `name` inside a full `executeFragmentSlots`/`fetchFragmentSlots`
    result (either the `FragmentSlotsExecution` envelope or the bare `.slots`
    record it wraps).
  - `{ response: FragmentRenderResponse | null | undefined; fallback: ReactNode }`
    — render an already-resolved response directly.
- `FragmentSlotStream({ slotPromise, fallback }: FragmentSlotStreamProps)` —
  the Suspense-compatible counterpart: `slotPromise: Promise<FragmentRenderResponse>`
  (typically one entry from a `streamFragmentSlots` handle's `.slots`),
  `fallback: ReactElement` (narrower than `<FragmentSlot>`'s `ReactNode` so
  this async Server Component's inferred return type stays assignable to
  `AwaitedReactNode`). `await`s its own promise, independent of sibling slots
  or of the page's full diagnostics aggregate — wrap it in
  `<Suspense fallback={...}>` to stream that slot's HTML in the moment its own
  promise resolves.

```tsx no-run
import { Suspense } from "react";
import { FragmentSlot, FragmentSlotStream } from "@mvp/runtime/react";

const FALLBACK = (
  <section data-fragment="price-panel" data-fallback="true">
    Price unavailable
  </section>
);

// Barrier lookup — `execution` already resolved (e.g. from executeFragmentSlots).
<FragmentSlot name="pricePanel" execution={execution} fallback={FALLBACK} />;

// Streaming — `stream` from streamFragmentSlots(...), one boundary per slot.
<Suspense fallback={FALLBACK}>
  <FragmentSlotStream slotPromise={stream.slots.pricePanel} fallback={FALLBACK} />
</Suspense>;
```

## Fragment backend proxy + page health

Two page-side contracts beyond slot composition.

**`FragmentManifest.proxy` → `/_fragment/<fragment>/<target>/*`** — the channel a
hydrated island uses to reach its own backend. The gateway mounts it; this package
owns the pure resolution (path parse, URL join, escape check). Modelled on
`@podium/proxy`.

**`PAGE_HEALTH_ATTR`** — a composed page stamps its aggregate health into a hidden
marker element (`<PageHealthMeta>` / `<PageHealthMetaStream>` from
`@mvp/runtime/react`; a hidden `div`, not a `<meta>`, because this is an internal
gateway signal rather than document metadata — React 19 would hoist a `<meta>`
into `<head>`, which is exactly where it does not belong),
and the gateway maps `unhealthy` (a **required** slot failed) to `503`. This is
Tailor's `primary` semantic; before it, a page with a dead required slot answered
`200` and crawlers indexed the degraded markup.

```ts
import {
  buildFragmentProxyUrl,
  failedRequiredSlotNames,
  FRAGMENT_PROXY_PREFIX,
  PAGE_HEALTH_ATTR,
  PAGE_HEALTH_FAILED_ATTR,
  parseFragmentProxyPath,
  readPageHealthFromHtml,
  resolveFragmentProxy,
} from "@mvp/runtime";

// A declared target resolves to an upstream URL…
const resolved = resolveFragmentProxy({
  pathname: `${FRAGMENT_PROXY_PREFIX}/order-form/quotes/BTC`,
  search: "?depth=10",
  proxyTargets: (fragment) =>
    fragment === "order-form" ? { quotes: "https://quotes.internal/v1" } : null,
});
if (!resolved.ok) throw new Error(`unexpected: ${resolved.reason}`);
if (resolved.url !== "https://quotes.internal/v1/BTC?depth=10") {
  throw new Error("proxy url wrong");
}

// …and the declared base is the boundary: the path after it comes from the
// browser, so a remainder that would escape is refused.
if (buildFragmentProxyUrl("https://quotes.internal/v1", "../admin") !== null) {
  throw new Error("escape not refused");
}
if (parseFragmentProxyPath("/markets") !== null) {
  throw new Error("non-proxy path must not parse");
}

// Page health: only REQUIRED slots count toward `unhealthy`.
const unhealthyExecution = {
  slots: {
    hero: {
      slot: { name: "hero", fragment: "hero", required: true },
      strategy: "dynamic-ssr" as const,
      source: "fallback" as const,
      status: "fallback" as const,
      response: {
        html: "",
        assets: { js: [], css: [] },
        cache: { ttl: 5, tags: [] },
        metadata: { name: "hero", version: "0", fallback: true },
      },
    },
  },
  data: {},
  health: "unhealthy" as const,
  hints: [],
};
if (failedRequiredSlotNames(unhealthyExecution)[0] !== "hero") {
  throw new Error("failed required slot not reported");
}

// What the gateway reads back out of the composed HTML.
const healthHtml = `<div hidden ${PAGE_HEALTH_ATTR}="unhealthy" ${PAGE_HEALTH_FAILED_ATTR}="hero"></div>`;
const marker = readPageHealthFromHtml(healthHtml);
if (marker?.health !== "unhealthy" || marker.failedSlots[0] !== "hero") {
  throw new Error("health marker not round-tripped");
}
// A page that does not stamp the marker has NO opinion — never "unhealthy".
if (readPageHealthFromHtml("<html></html>") !== null) {
  throw new Error("absent marker must be null");
}
```

## `@mvp/runtime/live` — manifest-driven realtime panels

A server-rendered, non-React panel (order book, trades tape, positions table)
stays live by subscribing to a data source and folding each frame into an
in-place DOM patch. **The fragment declares what it subscribes to; the page only
binds parameters.** Before this entry the page owned all three halves (which
fragments are live, which source each needs, how to patch each one's DOM), which
meant a fragment could not become live — or change what it listens to — without
a page edit.

- A fragment declares source-id **templates** in its manifest:
  `subscriptions: ["book.l2.<symbol>"]`. `GET /manifest` publishes them, so a
  new fragment version can change its own subscriptions and ship on its own.
  This is deliberately separate from `dataDependencies` (what SSR reads once).
- A fragment ships a `LivePanel` from its own `live` export: `fragment` (matches
  the SSR root's `data-fragment`), `subscriptions` (passed straight from the
  manifest), and `mount(ctx) -> { onFrame, stop? }`.
- The page calls `startLivePanels` with the panel list, the current parameter
  values and a `subscribe` adapter onto its data client. The driver never sees
  the client — only resolved source ids.

`ctx.remounted` is the one subtlety: it is `true` only when a parameter THAT
PANEL binds changed, which is how a panel knows its SSR rows went stale. A panel
on a parameter-free source (`positions`) keeps its rows across a symbol switch;
the order book, whose rows hold the previous symbol's prices, rebuilds.

```ts
import {
  type LivePanel,
  resolveSourceTemplate,
  startLivePanels,
  templateParams,
} from "@mvp/runtime/live";

// Templates bind their `<param>` placeholders; a global source binds nothing,
// which is what makes it survive a parameter change untouched.
console.assert(
  templateParams("book.l2.<symbol>").join() === "symbol",
  "book binds symbol",
);
console.assert(templateParams("positions").length === 0, "positions is global");
console.assert(
  resolveSourceTemplate("book.l2.<symbol>", { symbol: "BTC" }) === "book.l2.BTC",
);

// What a fragment ships from its `live` export.
const rendered: string[] = [];
const book: LivePanel = {
  fragment: "order-book",
  subscriptions: ["book.l2.<symbol>"],
  mount: ({ node, remounted }) => {
    // `remounted` decides whether the rendered rows can seed the first diff.
    let seeded = !remounted;
    return {
      onFrame(source, data) {
        rendered.push(`${source}:${seeded ? "patch" : "rebuild"}`);
        seeded = true;
        node.setAttribute("data-frames", String(rendered.length));
      },
    };
  },
};

// What the page supplies: the DOM, the parameters and a subscribe adapter.
const root = document.createElement("div");
const node = document.createElement("section");
node.setAttribute("data-fragment", "order-book");
root.appendChild(node);

const bus = new Map<string, (data: unknown) => void>();
const controller = startLivePanels({
  root,
  panels: [book],
  params: { symbol: "BTC" },
  subscribe: (source, onFrame) => {
    bus.set(source, onFrame);
    return () => bus.delete(source);
  },
});

console.assert(controller.mounted.join() === "order-book", "panel mounted");
bus.get("book.l2.BTC")?.({ bids: [] });
console.assert(rendered[0] === "book.l2.BTC:patch", "seeded from SSR rows");

// A parameter change re-subscribes and tells the panel its rows are stale.
controller.setParams({ symbol: "ETH" });
console.assert(bus.has("book.l2.ETH") && !bus.has("book.l2.BTC"), "rotated");
bus.get("book.l2.ETH")?.({ bids: [] });
console.assert(rendered[1] === "book.l2.ETH:rebuild", "rebuilt after switch");

controller.stop();
console.assert(bus.size === 0, "teardown cancels every subscription");
```

A panel whose fragment did not render, or rendered its fallback
(`data-fallback`), is skipped rather than mounted — composition already degraded
that slot and a live panel must not resurrect it. A panel that throws at mount
or on a frame is reported through `onError` and does not take the page down.

## Accept

```
pnpm --filter @mvp/runtime test
```
Expected: Vitest exits 0. `packages/runtime/src/index.test.ts` covers scheduler
ordering, timeout fallback, static/cache sourcing, the `health` rollup, and
`streamFragmentSlots`'s per-slot-before-aggregate settlement order (the
fast/slow-slot scenarios the streaming example above is based on);
`packages/runtime/src/react.test.tsx` covers `<FragmentSlot>`'s two prop
shapes (`execution` lookup and direct `response`) and its fallback rendering
for missing/null/undefined/empty-html responses.
