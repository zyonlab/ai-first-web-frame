# INTERACTION.md — bus / store / ACL model for AI consumers

Machine-actionable reference for cross-fragment client interaction: the
contract-enforced event bus (`@mvp/interaction`), the page-owned slice store
built on it (`@mvp/store`), the domain-contract layering rule, the island
hydration handshake (`@mvp/islands`), and — most importantly — the orphan-bus
failure mode and the audit rule that prevents it. Read this before writing any
`island.tsx`, any bus `publish`/`subscribe`, or any new slice contract. Related:
[OPERATIONS.md](./OPERATIONS.md) (lifecycle), [DELIVERY.md](./DELIVERY.md)
(affected/deploy), [COMPOSITION.md](./COMPOSITION.md) (slots/strategies),
[CONTRACTS.md](./CONTRACTS.md) (schema index).

---

## 1. The typed bus — `@mvp/interaction`

Source: `packages/interaction/src/index.ts`. Every channel is declared up
front by an `InteractionContract` (Zod schema `InteractionContractSchema` in
`packages/contracts/src/index.ts`):

```ts
{
  channel: string;                        // min length 1
  publisher: string;                      // the ONE identity allowed to publish
  subscribers: string[];                  // identities allowed to subscribe (default [])
  payloadSchema: Record<string, unknown>; // default {} = accept any payload
}
```

> **Known A2 gap (be honest with yourself when generating code):** `channel`
> is a bare `z.string().min(1)` — not a branded or enum type
> (`docs/ARCHITECTURE_REFACTOR_PLAN.md` §0 goal A2 / finding 4: "`channel` is
> `string`"). A typo'd channel fails at **runtime** (`InteractionContractError:
> channel "<x>" has no declared interaction contract`), not at typecheck.
> Always import channel ids from their domain constants (e.g.
> `TRADE_ACTIVE_SYMBOL` from `@mvp/trade-contracts`), never write string
> literals.

**Constructor** — `createInteractionBus({ contracts, onEvent?, now? })`
returns an `InteractionBus`:

| Method | Signature | ACL / validation behavior |
| --- | --- | --- |
| `publish` | `(channel, payload, { owner }) => Promise<{ subscriberCount }>` | Throws `InteractionContractError` if the channel has no contract, or if `owner !== contract.publisher`. Payload is validated against `payloadSchema` before delivery. |
| `subscribe` | `(channel, handler, { subscriber }) => () => void` | Throws `InteractionContractError` if the channel has no contract, or if `subscriber` is not in `contract.subscribers`. Returns an unsubscribe function. |
| `tap` | `(listener) => () => void` | Infrastructure-only observer (bridges, devtools). Fires synchronously for every publish and **bypasses** the subscriber ACL — not a substitute for `subscribe`. |
| `listChannels` | `() => string[]` | All declared channels. |
| `getContract` | `(channel) => InteractionContract \| undefined` | Contract lookup. |

`onEvent` (optional) receives `{ channel, owner, durationMs, subscriberCount }`
after each successful publish, for `@mvp/observability` wiring.

**Payload validation** (`validateInteractionPayload`): `payloadSchema` accepts
either a zod-like carrier (anything with `safeParse`) or a minimal JSON-Schema
subset — `type`, `properties`, `required`, `items`, `enum`,
`additionalProperties` (`false` rejects extras). An empty record `{}` accepts
any payload.

### Error taxonomy

Both error classes are exported from `packages/interaction/src/index.ts`;
detect by `error.name`, not message text.

| Error | Thrown when |
| --- | --- |
| `InteractionContractError` | Duplicate contract for a channel at bus construction; publish/subscribe on an undeclared channel; publish by a non-`publisher` owner; subscribe by an identity not in `subscribers`; payload fails `payloadSchema`; `createBroadcastBridge` asked to bridge an undeclared channel. |
| `MutationContractError` | `defineMutation(...).execute` asked to invalidate an undeclared cache tag, or the mutation input fails its declared `input` schema. |

### Mutations (same package)

`defineMutation<TInput, TResult>({ name, input?, invalidates })` declares a
server mutation contract: `execute(input, io, options?)` validates the input,
runs the injected `io.mutate`, then invalidates the declared tags through
`io.invalidate` (wire it to `createDataClient().mutateData`). Only tags listed
in `invalidates` may ever be invalidated — an undeclared tag throws
`MutationContractError` **before** any invalidation runs.

---

## 2. The store layer — `@mvp/store`

Source: `packages/store/src/index.ts`; full entry-point/error reference in
`packages/store/AGENT.md`. A generic, SSR-safe slice store built directly on
the bus. **Slice name === bus channel.** Zero domain vocabulary is hard-coded —
contracts come from the caller.

```ts
const store = createSliceStore<TSlices>(contracts, {
  initial,                 // TSlices — the SSR snapshot seed, one value per slice
  owner: "slice-store",   // default; must be each contract's publisher AND a subscriber
});
store.get(slice);          // current value; plain Error on undeclared slice
await store.set(slice, v); // update + bus.publish(channel, v, { owner })
store.subscribe(slice, listener); // bus.subscribe(..., { subscriber: owner })
store.bus;                 // the underlying InteractionBus (bridge/injection use)
```

- Undeclared slice → plain `Error`
  (`slice-store: slice "<channel>" has no declared interaction contract`).
- ACL/payload violations → `InteractionContractError` propagated unmodified
  from the bus.
- `useStoreSlice(store, slice)` — React hook on `useSyncExternalStore`;
  concurrent-mode and SSR-render safe (identical server/client snapshot
  function, no browser globals). This is how island components re-render on a
  slice change.

---

## 3. Domain contracts live in `domains/`, never in `packages/`

Goal B2/B3 (`docs/ARCHITECTURE_REFACTOR_PLAN.md` §0): framework packages
(`packages/**`) contain **zero** domain vocabulary; the dependency-audit rule
`domain-code-in-framework-package` (`tools/dependency-audit/src/index.ts`)
fails the build if domain code re-enters a framework package.

The trade demo's contracts live in `domains/trade-contracts/src/`:

| File | Contents |
| --- | --- |
| `slices.ts` | Frozen channel ids (`TRADE_ACTIVE_SYMBOL = "trade.active-symbol"`, `TRADE_ORDER_DRAFT`, `TRADE_ORDER_DRAFT_PRICE`, `TRADE_CHART_INTERVAL`, `TRADE_HOVERED_PRICE`, `TRADE_BOOK_GROUPING`, `TRADE_LEVERAGE`), payload types + JSON-Schema payloads, and TWO contract sets: `tradeSliceContracts` (canonical island-level publishers, e.g. `order-form` publishes leverage) and `tradeStoreContracts` (same channels reshaped with `TRADE_STORE_OWNER = "trade-store"` as publisher+subscriber so `createSliceStore` accepts them). |
| `mutations.ts` | `defineMutation` contracts (order placement etc.). |
| `flows.ts` | Pure reducers for the cross-island flows (`applyOrderbookPrice`, `applyLeverageChange`, symbol switch) — the deterministic core an island wires to an event before publishing. |

**Pages construct the store from domain contracts.** Reference implementation:
`apps/page-trade/src/tradeStore.ts` — one module-scope, lazily-memoized
`createSliceStore<TradeSlices>(tradeStoreContracts, { initial:
initialTradeSlices, owner: TRADE_STORE_OWNER })` (`getTradeStore()`), plus one
shared `createInteractionBus({ contracts: tradeSliceContracts })`
(`getTradeBus()`). Module-scope memoization is deliberate: islands mount into
detached SSR DOM nodes, so a React context provider cannot reach them.

---

## 4. Islands wiring — `@mvp/islands`

Source: `packages/islands/src/index.ts`. The frozen markup contract: a
fragment emits, per hydratable sub-part,
`<div data-island="<name>">` containing SSR HTML plus an inline
`<script type="application/json" data-island-props="<name>">` snapshot.

`IslandSnapshot` (validated against `IslandSnapshotSchema` in
`packages/contracts/src/index.ts`):

```ts
{ props, slice?, fragment?, version?, contractHash? }
```

- `registerIsland(name, component, expectation?)` — registers under the
  `data-island` name. The optional third argument
  `{ expectedVersion?, expectedContractHash?, propsSchema? }` is the C2/M3
  handshake declaration: `expectedVersion`/`expectedContractHash` (source
  from the fragment's own manifest export, e.g. `marketHeaderManifest.version`)
  opt into the version handshake; `propsSchema` (M3 — any Zod schema, or a
  hand-rolled object satisfying the same minimal `{ safeParse, description? }`
  contract as `@mvp/request`'s `ResponseSchema<T>`) opts into validating the
  EFFECTIVE props (`opts.props ?? snapshot.props`) after the version check
  passes. Omitting the whole third argument opts the island out of both
  (unconditional hydrate).
- `mountIsland(el, opts?)` / `hydrateIslands(root?)` — parse + Zod-validate
  the snapshot, run the version/contract-hash handshake, then (if declared)
  the propsSchema check, then `createRoot(el).render(...)`. `hydrateIslands`
  skips unregistered islands (never throws page-wide); `mountIsland` throws on
  a missing `data-island` name or unregistered name (authoring errors).
- **Skip-hydration degradation**: on `reason: "version-mismatch"`,
  `"contract-hash-mismatch"`, `"invalid-snapshot"` (unparseable/
  schema-failing snapshot JSON — the A2 case), or `"invalid-props"` (M3 —
  the snapshot envelope was valid but the effective props failed the
  island's own `propsSchema`; closes the gap `IslandSnapshotSchema.props`
  being `z.record(z.unknown())` leaves open), NO React root is created — the
  SSR HTML remains the final static state. The mismatch is `console.warn`ed
  unconditionally and also reported through the hook set via
  `configureIslandRuntime({ onSnapshotMismatch })` (a
  `SnapshotMismatchHandler` receiving `SnapshotMismatchInfo`). A snapshot with
  no `version` at all (old/non-participating fragment) hydrates normally —
  backward compatible by design; an island with no declared `propsSchema` is
  likewise unaffected by the M3 check.
- **Reference adoption**: `fragments/order-form`'s `OrderFormIslandPropsSchema`
  (`fragments/order-form/src/render.ts`) mirrors `OrderFormIslandProps`
  field-for-field, reusing `@mvp/trade-data`'s `AccountMarginSchema` directly
  for the `account` field (one source of truth, no drift). Wired in
  `apps/page-trade/src/hydrate.tsx`'s `registerTradeIslands` via a dedicated
  `@mvp/fragment-order-form/render` package export — deliberately NOT
  re-exported through `./island`, because `island.tsx` doubles as the entry
  `island.browser.ts` builds for the C3 spike's minimal browser bundle
  (`tools/bundle-budget-check`-measured, budget 30KB); a real (value)
  re-export of the schema from `island.tsx` pulled zod + the whole
  `@mvp/trade-data` module graph into that bundle, 4.6KB → 64.8KB, before
  being caught and fixed. `island.tsx`'s existing `import type
  { OrderFormIslandProps } from "./render"` stays type-only on purpose (a
  comment in-file says so) — anything importing a VALUE from `render.ts`
  belongs on the `./render` export path, not `./island`.

**Bus injection pattern**: every island component accepts an injected
`bus?: InteractionBus` prop and prefers it over its own
`createInteractionBus` fallback. The page's hydration bootstrap
(`apps/page-trade/src/hydrate.tsx`, `registerTradeIslands(store, bus)`) wraps
each registration to inject the shared page bus:

```ts
registerIsland(
  "accountBar",
  (props) => createElement(AccountBarIsland, { ...props, bus }),
  { expectedVersion: accountBarManifest.version },
);
```

The write-path island (`order-form`) instead receives the shared **store** as
an injected `deps` bundle — its leverage/price flow goes through
`store.set`/`store.subscribe`, not raw bus calls.

---

## 5. THE ORPHAN-BUS WARNING

`createInteractionBus` instances are **isolated** — each has its own
subscriber set. An island that constructs its own bus can publish and
subscribe locally and everything *looks* wired, but it is invisible to the
page's shared store/bus: no cross-island publish will ever reach it, and its
publishes reach nobody. This is a silent failure — no error, no warning, just
a dead interaction. It historically broke the market-header / chart-panel /
account-bar cross-island flows (`account-bar` had no escape hatch, so
order-form leverage changes never updated its margin preview —
`docs/ARCHITECTURE_REFACTOR_PLAN.md` §4.3.2).

**Anti-pattern (audit-FAILS the build):**

```tsx
// fragments/<name>/src/island.tsx — ORPHANED: private bus, no escape hatch
export function MyIsland(props: MyIslandProps) {
  const bus = createInteractionBus({ contracts: tradeSliceContracts });
  // subscribes fire only for THIS instance's publishes — never the page's
}
```

**Correct pattern (what market-header / chart-panel / account-bar do —
see `fragments/account-bar/src/island.tsx`):**

```tsx
export function MyIsland(props: MyIslandProps & { bus?: InteractionBus }) {
  const injectedBus = props.bus;
  const bus = useMemo(
    () => injectedBus ?? createInteractionBus({ contracts: tradeSliceContracts }),
    [injectedBus],
  );
  // page injects the shared bus; the private fallback exists only for
  // standalone/test rendering of the fragment in isolation
}
```

**Enforcement**: the dependency-audit check `island-bus-without-escape-hatch`
(`auditIslandBusEscapeHatch` in `tools/dependency-audit/src/index.ts`,
severity `fail`, runs inside `pnpm audit:deps` and therefore `pnpm verify`)
flags any `fragments/*/src/island.tsx` that calls `createInteractionBus(`
without the same file also declaring an escape hatch — matched as a `bus?:`
prop-type field or a `props.bus` access (regex heuristic, not AST). If your
island genuinely needs a bus, take it as an injected prop; if you hit this
audit, add the `injectedBus ?? createInteractionBus(...)` pattern, do not
suppress the rule.

---

## 6. Cross-tab bridging — `createBroadcastBridge`

`createBroadcastBridge(bus, { channels?, channelFactory? })`
(`packages/interaction/src/index.ts`) mirrors bus channels across execution
contexts (tabs/workers) over a `BroadcastChannel`-style transport. Behavior:

- Defaults to bridging every declared channel; bridging an undeclared channel
  throws `InteractionContractError`.
- Returns `{ status: "active" | "disabled", channels, close }` — degrades to
  an inert `"disabled"` no-op when no `BroadcastChannel` global exists (SSR).
- Echo prevention via a random `sourceId`; remote messages republish locally
  with their **original** owner; remote messages failing contract validation
  are dropped silently (never thrown across tabs).
- Uses `bus.tap` (the ACL-bypassing infra observer) for the outbound leg —
  the reference use case for `tap`.

No demo page currently wires a bridge; `store.bus` is the injection point when
one is needed (see `packages/store/AGENT.md`).
