# @mvp/islands — AGENT.md

## What this package is for

`@mvp/islands` is the framework's generic client-side island runtime: it
reads the frozen mount markup a fragment emits
(`<div data-island="<name>"><script type="application/json" data-island-props>...</script></div>`),
resolves the matching page-bundled component from a process-wide registry,
and hydrates it with `react-dom/client`. It was split out of the old
`packages/trade-client` in the P1 re-layering phase, then substantially
extended in P3 with the **snapshot version handshake (goal C2)**: because a
fragment service can be promoted/rolled back independently of the page bundle
that hydrates its SSR output, the live snapshot's shape can drift from what
the page-bundled island component was built against. `IslandSnapshot` now
optionally carries `{ fragment, version, contractHash }`, and
`registerIsland` accepts an optional `IslandVersionExpectation`
(`{ expectedVersion?, expectedContractHash? }`) declaring what the
page-bundled component was built against. When a live snapshot disagrees with
a declared expectation, `mountIsland` **skips hydration entirely** — no
`createRoot` call happens, the SSR HTML under the mount node is left as the
final static state — logs via `console.warn`, and invokes an optional
`configureIslandRuntime({ onSnapshotMismatch })` hook instead of depending on
`@mvp/observability` directly (a browser-side package has no business
depending on that request-scoped, server-side API surface). A snapshot with
no `version` at all (an old/non-participating fragment) is treated as a
match, not a mismatch, for backward compatibility. The same skip-hydration
path also covers **snapshot validation (goal A2, "never silent fallback")**:
before any version comparison, `mountIsland` parses the raw inline snapshot
JSON and validates it against `IslandSnapshotSchema` from `@mvp/contracts` —
a snapshot that is unparseable JSON, not an object, or has a field of the
wrong type skips hydration entirely (`reason: "invalid-snapshot"`) instead of
hydrating the component with empty/garbage props. Use this package inside a
page's client entry to register every island component the page ships and
hydrate the SSR markup on load.

## Entry points

- `registerIsland<TProps>(name: string, component: IslandComponent<TProps>, expectation?: IslandVersionExpectation): void`
  — registers `component` under `name` (its `data-island` value). Passing
  `expectation.expectedVersion` (typically sourced from the fragment's own
  manifest, e.g. `marketHeaderManifest.version`) opts this island into the
  C2 handshake: `mountIsland` will then verify the live snapshot's `version`
  matches before hydrating. Omitting the third argument entirely (or the
  whole `expectation` object) keeps unconditional-hydrate behavior — the
  registry also clears any previously-set expectation for `name` if you
  re-register without one.
- `configureIslandRuntime(config: { onSnapshotMismatch?: SnapshotMismatchHandler }): void`
  — sets the process-wide C2 mismatch hook a page calls once (e.g. alongside
  its `registerXIslands` bootstrap) to route mismatch events to real
  telemetry. `mountIsland` always `console.warn`s on a mismatch regardless of
  whether a hook is configured, so a mismatch is never silent.
- `mountIsland<TProps = Record<string, unknown>>(el: HTMLElement, opts?: MountIslandOptions<TProps>): IslandHandle`
  — hydrates one `[data-island]` node. Reads the `data-island` name (throws a
  plain `Error` if absent), resolves the registered component (throws if
  unregistered), then parses + validates the raw inline JSON snapshot against
  `IslandSnapshotSchema` (`@mvp/contracts`) — an unparseable/invalid snapshot
  skips hydration via the same degradation path as a C2 mismatch, with
  `reason: "invalid-snapshot"` and the parse/Zod problems in `issues`. On a
  valid snapshot it runs the C2 handshake check, and — on a match — merges
  `opts.props`/`opts.slice` over the snapshot's `props`/`slice` and mounts via
  `createRoot(el).render(...)`. On a **mismatch or invalid snapshot**, returns
  a no-op `IslandHandle` (`unmount()` does nothing) without ever calling
  `createRoot`. Returns `{ unmount(): void }`.
- `hydrateIslands(root?: ParentNode): IslandHandle[]` — scans `root`
  (defaults to `document`) for every `[data-island]` node and calls
  `mountIsland` on each one that has a registered component; unregistered
  islands are silently skipped (not thrown) so one missing island can't break
  the whole page's hydration. Returns the handles for every node it mounted
  or skipped-via-mismatch.
- `readIslandSnapshot<TProps = Record<string, unknown>>(el: Element): IslandSnapshot<TProps>`
  — parses the adjacent `<script type="application/json">` snapshot; missing
  or malformed JSON degrades to `{ props: {} }` rather than throwing, so a
  broken snapshot never crashes a best-effort read. Note `mountIsland` does
  NOT rely on this lenient fallback for hydration decisions: it validates the
  raw snapshot text itself first (A2) and skips hydration outright when the
  snapshot is present but invalid.
- `getIsland(name: string): IslandComponent<never> | undefined` — direct
  registry lookup, without mounting.
- `clearIslandRegistry(): void` — test/HMR helper: empties the registry, its
  C2 expectations, and the mismatch hook.
- `IslandSnapshot<TProps> = { props: TProps, slice?: string, fragment?: string, version?: string, contractHash?: string }`
  — the frozen inline-snapshot shape. `fragment`/`version`/`contractHash` are
  the C2 fields, all optional for backward compatibility with fragments that
  haven't adopted the handshake.
- `IslandVersionExpectation = { expectedVersion?: string, expectedContractHash?: string }`
  — what a page-bundled island component declares itself built against, via
  `registerIsland`'s third argument.
- `SnapshotMismatchInfo = { island: string, expected: { version?, contractHash? }, actual: { fragment?, version?, contractHash? }, reason: "version-mismatch" | "contract-hash-mismatch" | "invalid-snapshot", issues?: string[] }`
  — passed to the `console.warn` call and the `onSnapshotMismatch` hook.
  `reason` says which check failed: `"version-mismatch"` (declared
  `expectedVersion` differs from the snapshot's `version`),
  `"contract-hash-mismatch"` (versions match but a declared
  `expectedContractHash` differs from a present snapshot `contractHash`), or
  `"invalid-snapshot"` (the A2 case: the inline snapshot JSON was unparseable
  or failed `IslandSnapshotSchema` validation — not a version disagreement,
  just a corrupted/malformed payload, so `expected`/`actual` are empty).
  `issues` is present only when `reason` is `"invalid-snapshot"`: the
  JSON-parse error or Zod validation issues, for telemetry/debugging.
- `SnapshotMismatchHandler = (info: SnapshotMismatchInfo) => void` — the
  `configureIslandRuntime` callback type.
- `IslandComponent<TProps> = ComponentType<TProps & { slice?: string }>` /
  `IslandHandle = { unmount(): void }` / `MountIslandOptions<TProps> = { props?: TProps, slice?: string }`
  — supporting types for `registerIsland`/`mountIsland`.

## Error taxonomy

`mountIsland` throws plain `Error` (no dedicated error class) only for
**authoring bugs** in the frozen markup contract — never for a version-skew
or malformed-snapshot condition, both of which are handled by explicit
degradation instead of throwing:

- `Error("mountIsland: element is missing a data-island name attribute")` —
  the element passed to `mountIsland` directly has no `data-island`
  attribute. (`hydrateIslands` never triggers this, since it only calls
  `mountIsland` on nodes it already confirmed have the attribute.)
- `Error("mountIsland: no registered island named \"<name>\"")` — thrown
  when `mountIsland` is called directly on a node whose `data-island` name
  has no registered component. `hydrateIslands` avoids this by pre-filtering
  to `registry.has(name)` before calling `mountIsland`, so an unregistered
  island is silently skipped rather than throwing when discovered via
  `hydrateIslands`.

**C2 snapshot mismatch is not an exception.** When `registerIsland` declared
an `expectedVersion` and the live snapshot's `version` differs (or,
secondarily, `expectedContractHash` is declared and the snapshot's
`contractHash` differs while both are present), `mountIsland` skips
hydration, `console.warn`s, and calls the configured
`onSnapshotMismatch` hook (if any) — it returns a normal (no-op)
`IslandHandle`, it does not throw and does not reject. A snapshot with no
`version` field at all is always treated as a match (opt-in handshake).

**A2 invalid snapshot is not an exception either.** Before any version
comparison, `mountIsland` parses the raw inline snapshot JSON (when a
`<script type="application/json">` child is present) and validates it against
`IslandSnapshotSchema` from `@mvp/contracts`. Unparseable JSON, a non-object
top level (e.g. an array), or a field with the wrong type (e.g. `version` as
a number) skips hydration through the exact same path: `console.warn` (always)
plus the `onSnapshotMismatch` hook, with `reason: "invalid-snapshot"` and the
parse/Zod problems listed in `issues`, then a no-op handle — no `createRoot`
call ever happens and the SSR HTML stays as the final static state. A snapshot
merely missing optional fields (no `version`/`slice`/`fragment`/`contractHash`
— an old, non-participating fragment) is VALID and hydrates exactly as before;
a mount node with no snapshot script at all also hydrates (with `{ props: {} }`).

## Example

```ts
import { createElement } from "react";
import {
  clearIslandRegistry,
  configureIslandRuntime,
  hydrateIslands,
  registerIsland,
  type SnapshotMismatchInfo,
} from "@mvp/islands";

// The frozen mount markup a fragment emits for each hydratable sub-part:
// <div data-island="<name>">
//   <script type="application/json" data-island-props="<name>">{...}</script>
// </div>
function buildMountNode(name: string, snapshotJson: string): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("data-island", name);
  const script = document.createElement("script");
  script.setAttribute("type", "application/json");
  script.setAttribute("data-island-props", name);
  script.textContent = snapshotJson;
  el.appendChild(script);
  return el;
}

// 1. Route mismatch/invalid-snapshot reports to real telemetry. Called once
//    per page, alongside its register* bootstrap; `mountIsland` always also
//    console.warn's, so a skipped hydration is never silent.
const reports: SnapshotMismatchInfo[] = [];
configureIslandRuntime({
  onSnapshotMismatch: (info) => reports.push(info),
});

// 2. C2 handshake: register the page-bundled component under its data-island
//    name and declare the fragment version it was built against (in a real
//    page, sourced from the fragment's own manifest version).
const MarketHeader = (props: { symbol?: string }) =>
  createElement("span", null, props.symbol);
registerIsland("market-header", MarketHeader, { expectedVersion: "2.0.0" });

// 3a. The live SSR snapshot carries version 1.0.0 (the fragment service was
//     rolled back independently of this page bundle) -> version-mismatch.
document.body.appendChild(
  buildMountNode(
    "market-header",
    JSON.stringify({
      props: { symbol: "BTC-USD" },
      fragment: "market-header",
      version: "1.0.0",
    }),
  ),
);

// 3b. A corrupted inline snapshot -> invalid-snapshot (A2 validation).
document.body.appendChild(buildMountNode("market-header", "{not json"));

// 4. Client entry: hydrate every [data-island] node in the document. Both
//    nodes above are skipped — createRoot is never called, their SSR HTML
//    stays as the final paint — but each still yields a safe no-op handle.
//    (A snapshot whose version matches, or that omits `version` entirely,
//    would hydrate normally here instead.)
const handles = hydrateIslands();
console.log(handles.length); // 2

console.log(reports.map((r) => r.reason)); // ["version-mismatch", "invalid-snapshot"]
console.log(reports[0]?.expected.version); // "2.0.0"
console.log(reports[0]?.actual.version); // "1.0.0"
console.log(reports[1]?.issues?.length); // 1 (the JSON parse error)

// Later, e.g. on page teardown (safe even for skipped islands):
for (const handle of handles) handle.unmount();
clearIslandRegistry(); // test/HMR helper: also clears expectations + the hook
```

## Accept

```
pnpm --filter @mvp/islands test
```
Expected: Vitest exits 0. `packages/islands/src/index.test.ts` covers
registry/expectation bookkeeping, `readIslandSnapshot`'s malformed-JSON
fallback, the C2 handshake's match/mismatch/backward-compatible-no-version
paths (including that a mismatch skips `createRoot` and returns a no-op
handle while still invoking `console.warn` and the configured hook), the A2
invalid-snapshot paths (malformed JSON, non-object top level, wrong-typed
field — each skips hydration and reports `reason: "invalid-snapshot"`, while
a snapshot merely missing optional fields still hydrates), and
`hydrateIslands`'s silent-skip behavior for unregistered islands.
