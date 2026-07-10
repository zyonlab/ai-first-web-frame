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
match, not a mismatch, for backward compatibility. Use this package inside a
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
  unregistered), reads the inline JSON snapshot (`readIslandSnapshot`), runs
  the C2 handshake check, and — on a match — merges `opts.props`/`opts.slice`
  over the snapshot's `props`/`slice` and mounts via `createRoot(el).render(...)`.
  On a **mismatch**, returns a no-op `IslandHandle` (`unmount()` does
  nothing) without ever calling `createRoot`. Returns
  `{ unmount(): void }`.
- `hydrateIslands(root?: ParentNode): IslandHandle[]` — scans `root`
  (defaults to `document`) for every `[data-island]` node and calls
  `mountIsland` on each one that has a registered component; unregistered
  islands are silently skipped (not thrown) so one missing island can't break
  the whole page's hydration. Returns the handles for every node it mounted
  or skipped-via-mismatch.
- `readIslandSnapshot<TProps = Record<string, unknown>>(el: Element): IslandSnapshot<TProps>`
  — parses the adjacent `<script type="application/json">` snapshot; missing
  or malformed JSON degrades to `{ props: {} }` rather than throwing, so a
  broken snapshot never crashes hydration.
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
- `SnapshotMismatchInfo = { island: string, expected: { version?, contractHash? }, actual: { fragment?, version?, contractHash? }, reason: "version-mismatch" | "contract-hash-mismatch" }`
  — passed to the `console.warn` call and the `onSnapshotMismatch` hook.
- `SnapshotMismatchHandler = (info: SnapshotMismatchInfo) => void` — the
  `configureIslandRuntime` callback type.
- `IslandComponent<TProps> = ComponentType<TProps & { slice?: string }>` /
  `IslandHandle = { unmount(): void }` / `MountIslandOptions<TProps> = { props?: TProps, slice?: string }`
  — supporting types for `registerIsland`/`mountIsland`.

## Error taxonomy

`mountIsland` throws plain `Error` (no dedicated error class) only for
**authoring bugs** in the frozen markup contract — never for a version-skew
condition, which is handled by explicit degradation instead of throwing:

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

## Example

```ts
import {
  registerIsland,
  hydrateIslands,
  configureIslandRuntime,
  type SnapshotMismatchInfo,
} from "@mvp/islands";
import { MarketHeader, manifest as marketHeaderManifest } from "@mvp/fragment-market-header/island";

// C2 handshake: declare what this page-bundled island expects.
registerIsland("market-header", MarketHeader, {
  expectedVersion: marketHeaderManifest.version,
});

configureIslandRuntime({
  onSnapshotMismatch: (info: SnapshotMismatchInfo) => {
    // Route to real telemetry instead of relying on console.warn alone.
    reportToObservability("island_snapshot_mismatch", info);
  },
});

// Client entry: hydrate every [data-island] node found in the document.
// A version-mismatched island is skipped; its SSR HTML stays as the final
// paint instead of a broken/mis-hydrated mount.
const handles = hydrateIslands();

// Later, e.g. on page teardown:
for (const handle of handles) handle.unmount();
```

## Accept

```
pnpm --filter @mvp/islands test
```
Expected: Vitest exits 0. `packages/islands/src/index.test.ts` covers
registry/expectation bookkeeping, `readIslandSnapshot`'s malformed-JSON
fallback, the C2 handshake's match/mismatch/backward-compatible-no-version
paths (including that a mismatch skips `createRoot` and returns a no-op
handle while still invoking `console.warn` and the configured hook), and
`hydrateIslands`'s silent-skip behavior for unregistered islands.
