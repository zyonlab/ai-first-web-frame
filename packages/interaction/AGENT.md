# @mvp/interaction — AGENT.md

## What this package is for

`@mvp/interaction` is the domain-agnostic, contract-first cross-component
messaging core: a typed pub/sub event bus with publisher/subscriber ACL
enforcement, a server-mutation wrapper that only invalidates declared cache
tags, and a cross-tab/cross-worker broadcast bridge. It has no knowledge of
any business domain — every channel, publisher, subscriber, and payload shape
is declared up front via `InteractionContract` (`@mvp/contracts`) and enforced
at publish/subscribe time. Domain-specific contracts (e.g. trade channels)
live outside this package (in `domains/*-contracts`) and are passed in as data
when constructing a bus; this package never re-exports or hard-codes them.
Use it inside fragments/islands that need to talk to each other or to a
page-owned store without a direct import dependency between them.

## Entry points

- `createInteractionBus(options: InteractionBusOptions): InteractionBus` —
  builds a bus over a fixed set of `InteractionContract`s
  (`{ contracts: InteractionContract[], onEvent?, now? }`). Every channel used
  by `publish`/`subscribe` must appear in `contracts`; throws
  `InteractionContractError` on construction if two contracts declare the same
  `channel`. Returns
  `{ publish, subscribe, tap, listChannels, getContract }`. Use once per
  page/store to own a set of channels; islands/fragments receive the resulting
  `InteractionBus` as a prop rather than constructing their own.
- `bus.publish(channel: string, payload: unknown, options: { owner: string }): Promise<{ subscriberCount: number }>`
  — validates `owner` against the contract's declared `publisher`, validates
  `payload` against `payloadSchema`, fires all `tap` listeners synchronously,
  then awaits every subscribed handler in parallel and reports
  `onEvent({ channel, owner, durationMs, subscriberCount })`. Throws
  `InteractionContractError` if `channel` is undeclared, `owner` isn't the
  declared publisher, or the payload fails schema validation.
- `bus.subscribe(channel: string, handler: InteractionHandler, options: { subscriber: string }): () => void`
  — registers `handler` for `channel`; throws `InteractionContractError` if
  `channel` is undeclared or `subscriber` is not in the contract's
  `subscribers` list. Returns an unsubscribe function.
- `bus.tap(listener: (message: InteractionMessage) => void): () => void` —
  infrastructure-level observer (bridges, devtools) that fires synchronously
  for every published message regardless of subscriber declarations; not a
  substitute for `subscribe`. Returns an untap function.
- `bus.listChannels(): string[]` / `bus.getContract(channel: string): InteractionContract | undefined`
  — introspection helpers, used by `createBroadcastBridge` to default its
  channel set and validate bridged channels are declared.
- `defineMutation<TInput = unknown, TResult = unknown>(definition: MutationDefinition): Mutation<TInput, TResult>`
  — declares a server mutation contract
  (`{ name, input?: Record<string, unknown>, invalidates: string[] }`).
  Returns `{ name, invalidates, execute }` where
  `execute(input, io: MutationIO<TInput, TResult>, options?: { invalidates?: string[] }): Promise<{ result: TResult, invalidated: string[] }>`
  validates `input` against `definition.input` (if present), calls
  `io.mutate(validated)`, then `io.invalidate(tags)` where `tags` defaults to
  `definition.invalidates` (or the `options.invalidates` subset — anything not
  in the declared set throws first). `io.mutate`/`io.invalidate` are injected
  by the caller (typically wired to `@mvp/data`'s `mutateData`) so this
  package stays decoupled from any specific data-fetch implementation.
- `createBroadcastBridge(bus: InteractionBus, options?: BroadcastBridgeOptions): BroadcastBridge`
  — bridges a bus's channels across execution contexts (tabs/workers) over a
  `BroadcastChannel`-style transport. `options.channels` defaults to
  `bus.listChannels()`; throws `InteractionContractError` if any requested
  channel has no declared contract. `options.channelFactory` defaults to the
  global `BroadcastChannel` constructor; when unavailable (or `channels` is
  empty), returns `{ status: "disabled", channels: [], close }` instead of
  throwing. Remote messages that fail contract validation on republish are
  dropped silently (not thrown); local publishes are never re-broadcast back
  to their own source (echo prevention via `sourceId`). Returns
  `{ status: "active" | "disabled", channels: string[], close: () => void }`.
- `validateInteractionPayload(schema: Record<string, unknown> | undefined, payload: unknown, context: string): unknown`
  — the payload validator used internally by `publish` and `defineMutation`;
  exported for reuse. Accepts either a zod-like schema (anything with
  `safeParse`) or a minimal JSON-Schema subset (`type`, `properties`,
  `required`, `items`, `enum`, `additionalProperties`). An empty/undefined
  schema accepts any payload unchanged.

## Error taxonomy

- **`InteractionContractError`** — thrown by `createInteractionBus` on a
  duplicate `channel` across contracts; by `bus.publish`/`bus.subscribe` when
  the channel is undeclared, the publisher/subscriber identity doesn't match
  the contract, or the payload fails schema validation
  (`validateInteractionPayload`); and by `createBroadcastBridge` when asked to
  bridge a channel with no declared contract. This is the ACL-violation error
  type — always a caller/config bug, never a transient condition.
- **`MutationContractError`** — thrown by a `defineMutation`-produced
  `execute` when the caller requests invalidation of a tag not in the
  mutation's declared `invalidates` set, or when the input fails
  `definition.input` validation (the underlying `InteractionContractError`
  from `validateInteractionPayload` is caught and re-thrown as
  `MutationContractError` so mutation callers only ever see one error type).

Both extend `Error` with `name` set to the class name. `io.mutate` /
`io.invalidate` rejections and `handler` rejections inside `publish` are not
caught by this package — they propagate to the caller (`publish` uses
`Promise.all` over all subscribed handlers, so one rejecting handler rejects
the whole publish).

## Example

```ts
import {
  createInteractionBus,
  defineMutation,
  InteractionContractError,
  type InteractionContract,
} from "@mvp/interaction";

const contracts: InteractionContract[] = [
  {
    channel: "cart.updated",
    publisher: "cart-fragment",
    subscribers: ["header-badge-island"],
    payloadSchema: {
      type: "object",
      required: ["itemCount"],
      properties: { itemCount: { type: "number" } },
    },
  },
];

const bus = createInteractionBus({
  contracts,
  onEvent: (event) => console.log("published", event.channel, event.durationMs),
});

const unsubscribe = bus.subscribe(
  "cart.updated",
  (payload) => console.log("badge sees", payload),
  { subscriber: "header-badge-island" },
);

await bus.publish("cart.updated", { itemCount: 3 }, { owner: "cart-fragment" });

// Wrong publisher identity is rejected loudly, not silently dropped:
try {
  await bus.publish("cart.updated", { itemCount: 4 }, { owner: "someone-else" });
} catch (error) {
  if (error instanceof InteractionContractError) {
    console.error(error.message);
  }
}

const addToCart = defineMutation<{ sku: string }, { itemCount: number }>({
  name: "addToCart",
  invalidates: ["cart"],
});

const { result, invalidated } = await addToCart.execute(
  { sku: "sku-123" },
  {
    mutate: async (input) => ({ itemCount: 3 }),
    invalidate: async (tags) => console.log("invalidating", tags),
  },
);

unsubscribe();
```

## Accept

```
pnpm --filter @mvp/interaction test
```
Expected: Vitest exits 0. `packages/interaction/src/index.test.ts` covers
contract-enforced publish/subscribe ACLs, payload schema validation (both
zod-like and JSON-Schema-subset paths), `defineMutation`'s undeclared-tag
rejection, and the broadcast bridge's echo-prevention/disabled-transport
behavior.
