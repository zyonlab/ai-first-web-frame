# @mvp/store — AGENT.md

## What this package is for

`@mvp/store` is a generic, SSR-safe client-side slice store built directly on
top of `@mvp/interaction`'s contract-enforced bus. It has no hard-coded
domain vocabulary: the caller supplies one `InteractionContract` per slice
(channel) at construction time (typically sourced from a domain package, e.g.
`domains/trade-contracts`), and the store uses each slice name as the bus
channel — `set` publishes, `subscribe`/`get` observe. It holds state purely
in memory and never touches a browser global, so it can be constructed on the
server without throwing, and its React hook (`useStoreSlice`) is built on
`useSyncExternalStore` so it's concurrent-mode and SSR-render safe. This
package was split out of the old `packages/trade-client` in the P1
re-layering phase; its constructor was renamed from `createTradeStore` to
`createSliceStore` to make the generic contract explicit. Use it as the
page-owned shared store islands read/write through, wired with domain
contracts from the domain layer.

## Entry points

- `createSliceStore<TSlices extends Record<string, unknown>>(contracts: InteractionContract[], options: CreateSliceStoreOptions<TSlices>): SliceStore<TSlices>`
  — `options: { initial: TSlices, owner?: string = "slice-store" }`. Builds
  an internal `InteractionBus` (`createInteractionBus({ contracts })`) and
  seeds an in-memory value map from `options.initial` (the SSR snapshot
  seed). Every contract must declare `owner` as its `publisher` and include
  it in `subscribers` for that slice's `set`/`subscribe` to work — this is
  the same publisher/subscriber ACL `@mvp/interaction` enforces, just applied
  with the store as the sole actor. Returns a `SliceStore<TSlices>`.
- `SliceStore<TSlices>` — `{ get, set, subscribe, bus }`:
  - `get<K extends keyof TSlices>(slice: K): TSlices[K]` — reads the current
    in-memory value; throws a plain `Error` if `slice` has no declared
    contract.
  - `set<K extends keyof TSlices>(slice: K, value: TSlices[K]): Promise<void>`
    — updates the in-memory value synchronously, then
    `await bus.publish(channel, value, { owner })`; throws the same
    undeclared-channel `Error` up front, and propagates
    `InteractionContractError` from the underlying `bus.publish` if `owner`
    doesn't match the contract's declared `publisher`.
  - `subscribe<K extends keyof TSlices>(slice: K, listener: (value: TSlices[K]) => void): () => void`
    — wraps `bus.subscribe(channel, ..., { subscriber: owner })`; same
    undeclared-channel `Error`, and the underlying bus throws
    `InteractionContractError` if `owner` isn't a declared subscriber for
    that channel.
  - `bus: InteractionBus` — the underlying `@mvp/interaction` bus, exposed
    for advanced use (e.g. wiring a `createBroadcastBridge` across tabs, or
    injecting the same bus into islands as their escape-hatch `bus` prop).
- `useStoreSlice<TSlices extends Record<string, unknown>, K extends keyof TSlices>(store: SliceStore<TSlices>, slice: K): TSlices[K]`
  — React hook: `useSyncExternalStore(subscribe, getSnapshot, getSnapshot)`
  wired to `store.subscribe`/`store.get` for the given `slice`, memoized on
  `[store, slice]`. Re-renders the component whenever that slice changes;
  identical server/client snapshot function so hydration doesn't mismatch.

## Error taxonomy

- **Plain `Error`** (`"slice-store: slice \"<channel>\" has no declared interaction contract"`)
  — thrown by `get`/`set`/`subscribe` (via the internal `requireChannel`
  guard) when called with a slice name that has no matching entry in
  `contracts`. This is always a caller bug (typo'd slice name, or a contract
  that was never passed to `createSliceStore`).
- **`InteractionContractError`** (from `@mvp/interaction`, re-thrown
  unmodified) — surfaces from `set`/`subscribe` when the store's `owner`
  isn't the declared `publisher`/a declared `subscriber` for that slice's
  contract, or if the payload published via `set` fails the contract's
  `payloadSchema`. This package does not catch or wrap it — see
  `packages/interaction/AGENT.md` for the full taxonomy.

## Example

```tsx
import { createSliceStore, useStoreSlice, type SliceStore } from "@mvp/store";
import type { InteractionContract } from "@mvp/contracts";

type Slices = { activeSymbol: string };

const contracts: InteractionContract[] = [
  {
    channel: "activeSymbol",
    publisher: "slice-store",
    subscribers: ["slice-store", "symbol-picker-island"],
    payloadSchema: { type: "string" },
  },
];

const store: SliceStore<Slices> = createSliceStore(contracts, {
  initial: { activeSymbol: "BTC-USD" },
});

// Server or client: read/write without any browser global.
console.log(store.get("activeSymbol")); // "BTC-USD"
await store.set("activeSymbol", "ETH-USD");

// Inside a React island:
function SymbolLabel({ store }: { store: SliceStore<Slices> }) {
  const activeSymbol = useStoreSlice(store, "activeSymbol");
  return <span>{activeSymbol}</span>;
}
```

## Accept

```
pnpm --filter @mvp/store test
```
Expected: Vitest exits 0. `packages/store/src/index.test.ts` covers
contract-gated slice access, `set`/`subscribe` publishing through the
underlying bus, and `useStoreSlice`'s re-render-on-change behavior.
