# @mvp/interaction

Contract-first interaction primitives for cross-container communication
(shell ↔ page ↔ fragment ↔ client island). Every channel, publisher,
subscriber, and payload shape must be declared as an `InteractionContract`
(see `@mvp/contracts`) before it can be used — undeclared usage throws.

## 1. Declare contracts

```ts
import type { InteractionContract } from "@mvp/contracts";

const contracts: InteractionContract[] = [
  {
    channel: "cart:add",
    publisher: "fragment-recommendation-widget",
    subscribers: ["page-product", "fragment-promotion-banner"],
    // Minimal JSON-Schema subset: type/properties/required/items/enum/additionalProperties.
    // An empty object {} accepts any payload. A zod-like schema carrying
    // `safeParse` is also accepted and parsed directly.
    payloadSchema: {
      type: "object",
      properties: { productId: { type: "string" }, quantity: { type: "integer" } },
      required: ["productId"],
    },
  },
];
```

## 2. Create the bus, publish, subscribe

```ts
import { createInteractionBus } from "@mvp/interaction";

const bus = createInteractionBus({
  contracts,
  // Optional trace hook — wire this to @mvp/observability spans.
  onEvent: ({ channel, owner, durationMs, subscriberCount }) =>
    trace.log("interaction", { channel, owner, durationMs, subscriberCount }),
});

// Subscriber identity must be in the contract's `subscribers` list.
const unsubscribe = bus.subscribe(
  "cart:add",
  (payload, { owner }) => updateCartBadge(payload),
  { subscriber: "page-product" },
);

// Owner must be the declared `publisher`; payload is validated first.
await bus.publish("cart:add", { productId: "p-1", quantity: 2 }, {
  owner: "fragment-recommendation-widget",
});
```

Violations throw `InteractionContractError`: undeclared channel, wrong
publisher, unlisted subscriber, or payload schema failure.

## 3. Server mutation contract

Mutations declare up front which cache tags they may invalidate. `mutate`
and `invalidate` are injected so the package stays decoupled from
`@mvp/data` — pass `dataClient.mutateData`-backed callbacks at the call site.

```ts
import { defineMutation } from "@mvp/interaction";

const addToCart = defineMutation<{ productId: string }, { ok: boolean }>({
  name: "cart.add",
  input: { type: "object", properties: { productId: { type: "string" } }, required: ["productId"] },
  invalidates: ["cart", "cart:badge"],
});

const { result, invalidated } = await addToCart.execute(
  { productId: "p-1" },
  {
    mutate: (input) => api.post("/cart", input),
    invalidate: (tags) => tags.forEach((tag) => dataClient.mutateData(tag)),
  },
  // Optional: narrow to a declared subset. Undeclared tags throw
  // MutationContractError before anything is invalidated.
  { invalidates: ["cart"] },
);
```

## 4. Cross-context bridge

Bridges bus channels across tabs/workers over a BroadcastChannel-style
transport. Incoming messages are republished locally with their original
owner and never re-broadcast (echo prevention). Remote messages that fail
contract validation are dropped.

```ts
import { createBroadcastBridge } from "@mvp/interaction";

// Browser: uses the global BroadcastChannel by default.
const bridge = createBroadcastBridge(bus, { channels: ["cart:add"] });
bridge.status; // "active", or "disabled" when BroadcastChannel is unavailable (no-op)
bridge.close();

// Tests / custom transports: inject a channel factory.
createBroadcastBridge(bus, {
  channels: ["cart:add"],
  channelFactory: (name) => myInMemoryHub.createPort(name),
});
```

## API summary

- `createInteractionBus({ contracts, onEvent?, now? })` → `{ publish, subscribe, tap, listChannels, getContract }`
- `defineMutation({ name, input?, invalidates })` → `{ name, invalidates, execute(input, { mutate, invalidate }, options?) }`
- `createBroadcastBridge(bus, { channels?, channelFactory? })` → `{ status, channels, close }`
- `validateInteractionPayload(schema, payload, context)` — shared payload validator
- Errors: `InteractionContractError`, `MutationContractError`
