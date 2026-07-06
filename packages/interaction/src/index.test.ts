import type { InteractionContract } from "@mvp/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BroadcastChannelLike,
  createBroadcastBridge,
  createInteractionBus,
  defineMutation,
  InteractionContractError,
  MutationContractError,
} from "./index";

const cartContract: InteractionContract = {
  channel: "cart:add",
  publisher: "fragment-recommendation-widget",
  subscribers: ["page-product", "fragment-promotion-banner"],
  payloadSchema: {
    type: "object",
    properties: {
      productId: { type: "string" },
      quantity: { type: "integer" },
    },
    required: ["productId"],
    additionalProperties: false,
  },
};

const filterContract: InteractionContract = {
  channel: "filter:change",
  publisher: "page-home",
  subscribers: ["fragment-recommendation-widget"],
  payloadSchema: {},
};

function makeBus(overrides?: Parameters<typeof createInteractionBus>[0]) {
  return createInteractionBus(
    overrides ?? { contracts: [cartContract, filterContract] },
  );
}

describe("createInteractionBus", () => {
  it("delivers payloads from declared publisher to declared subscribers", async () => {
    const bus = makeBus();
    const handler = vi.fn();
    bus.subscribe("cart:add", handler, { subscriber: "page-product" });
    const receipt = await bus.publish(
      "cart:add",
      { productId: "p-1", quantity: 2 },
      { owner: "fragment-recommendation-widget" },
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      { productId: "p-1", quantity: 2 },
      { channel: "cart:add", owner: "fragment-recommendation-widget" },
    );
    expect(receipt.subscriberCount).toBe(1);
  });

  it("rejects publish and subscribe on undeclared channels", async () => {
    const bus = makeBus();
    await expect(
      bus.publish("unknown:channel", {}, { owner: "page-home" }),
    ).rejects.toThrow(InteractionContractError);
    expect(() =>
      bus.subscribe("unknown:channel", vi.fn(), { subscriber: "page-home" }),
    ).toThrow(InteractionContractError);
  });

  it("rejects publish from an owner that is not the declared publisher", async () => {
    const bus = makeBus();
    await expect(
      bus.publish(
        "cart:add",
        { productId: "p-1" },
        { owner: "fragment-promotion-banner" },
      ),
    ).rejects.toThrow(/not the declared publisher/);
  });

  it("rejects subscribe from an identity not in declared subscribers", () => {
    const bus = makeBus();
    expect(() =>
      bus.subscribe("cart:add", vi.fn(), { subscriber: "shell-gateway" }),
    ).toThrow(/not a declared subscriber/);
  });

  it("rejects payloads that fail the contract payloadSchema", async () => {
    const bus = makeBus();
    await expect(
      bus.publish(
        "cart:add",
        { quantity: 1 },
        { owner: "fragment-recommendation-widget" },
      ),
    ).rejects.toThrow(/required property "productId"/);
    await expect(
      bus.publish(
        "cart:add",
        { productId: "p-1", quantity: 1.5 },
        { owner: "fragment-recommendation-widget" },
      ),
    ).rejects.toThrow(/integer/);
    await expect(
      bus.publish(
        "cart:add",
        { productId: "p-1", extra: true },
        { owner: "fragment-recommendation-widget" },
      ),
    ).rejects.toThrow(/additional property/);
  });

  it("supports zod-like payload schemas carrying a safeParse function", async () => {
    const zodLike = {
      safeParse: (value: unknown) =>
        typeof value === "string"
          ? { success: true as const, data: value.trim() }
          : {
              success: false as const,
              error: new Error("expected string"),
            },
    };
    const bus = createInteractionBus({
      contracts: [
        {
          channel: "note:add",
          publisher: "page-home",
          subscribers: ["fragment-promotion-banner"],
          payloadSchema: zodLike as unknown as Record<string, unknown>,
        },
      ],
    });
    const handler = vi.fn();
    bus.subscribe("note:add", handler, {
      subscriber: "fragment-promotion-banner",
    });
    await bus.publish("note:add", "  hello  ", { owner: "page-home" });
    expect(handler).toHaveBeenCalledWith(" hello ".trim(), {
      channel: "note:add",
      owner: "page-home",
    });
    await expect(
      bus.publish("note:add", 42, { owner: "page-home" }),
    ).rejects.toThrow(InteractionContractError);
  });

  it("rejects duplicate channel declarations and invalid contracts", () => {
    expect(() =>
      createInteractionBus({ contracts: [cartContract, cartContract] }),
    ).toThrow(/duplicate/);
    expect(() =>
      createInteractionBus({
        contracts: [
          { channel: "", publisher: "x" } as unknown as InteractionContract,
        ],
      }),
    ).toThrow();
  });

  it("stops delivery after unsubscribe", async () => {
    const bus = makeBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe("filter:change", handler, {
      subscriber: "fragment-recommendation-widget",
    });
    await bus.publish("filter:change", { q: "a" }, { owner: "page-home" });
    unsubscribe();
    await bus.publish("filter:change", { q: "b" }, { owner: "page-home" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("awaits async subscriber handlers before resolving publish", async () => {
    const bus = makeBus();
    let settled = false;
    bus.subscribe(
      "filter:change",
      async () => {
        await Promise.resolve();
        settled = true;
      },
      { subscriber: "fragment-recommendation-widget" },
    );
    await bus.publish("filter:change", {}, { owner: "page-home" });
    expect(settled).toBe(true);
  });

  it("reports trace events through the onEvent hook", async () => {
    const onEvent = vi.fn();
    const bus = createInteractionBus({
      contracts: [cartContract, filterContract],
      onEvent,
    });
    bus.subscribe("cart:add", vi.fn(), { subscriber: "page-product" });
    bus.subscribe("cart:add", vi.fn(), {
      subscriber: "fragment-promotion-banner",
    });
    await bus.publish(
      "cart:add",
      { productId: "p-9" },
      { owner: "fragment-recommendation-widget" },
    );
    expect(onEvent).toHaveBeenCalledTimes(1);
    const event = onEvent.mock.calls[0][0];
    expect(event.channel).toBe("cart:add");
    expect(event.owner).toBe("fragment-recommendation-widget");
    expect(event.subscriberCount).toBe(2);
    expect(typeof event.durationMs).toBe("number");
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("lists declared channels and exposes contracts", () => {
    const bus = makeBus();
    expect(bus.listChannels().sort()).toEqual(["cart:add", "filter:change"]);
    expect(bus.getContract("cart:add")?.publisher).toBe(
      "fragment-recommendation-widget",
    );
    expect(bus.getContract("nope")).toBeUndefined();
  });
});

describe("defineMutation", () => {
  const addToCart = defineMutation<{ productId: string }, { ok: boolean }>({
    name: "cart.add",
    input: {
      type: "object",
      properties: { productId: { type: "string" } },
      required: ["productId"],
    },
    invalidates: ["cart", "cart:badge"],
  });

  it("runs the injected mutate then invalidates all declared tags", async () => {
    const mutate = vi.fn(async () => ({ ok: true }));
    const invalidate = vi.fn();
    const outcome = await addToCart.execute(
      { productId: "p-1" },
      { mutate, invalidate },
    );
    expect(mutate).toHaveBeenCalledWith({ productId: "p-1" });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith(["cart", "cart:badge"]);
    expect(outcome).toEqual({
      result: { ok: true },
      invalidated: ["cart", "cart:badge"],
    });
  });

  it("allows narrowing invalidation to a declared subset", async () => {
    const invalidate = vi.fn();
    await addToCart.execute(
      { productId: "p-1" },
      { mutate: async () => ({ ok: true }), invalidate },
      { invalidates: ["cart"] },
    );
    expect(invalidate).toHaveBeenCalledWith(["cart"]);
  });

  it("throws when asked to invalidate an undeclared tag and never invalidates", async () => {
    const invalidate = vi.fn();
    await expect(
      addToCart.execute(
        { productId: "p-1" },
        { mutate: async () => ({ ok: true }), invalidate },
        { invalidates: ["cart", "orders"] },
      ),
    ).rejects.toThrow(MutationContractError);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("validates input before running mutate", async () => {
    const mutate = vi.fn();
    const invalidate = vi.fn();
    await expect(
      addToCart.execute({} as { productId: string }, { mutate, invalidate }),
    ).rejects.toThrow(MutationContractError);
    expect(mutate).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});

type MemoryPort = BroadcastChannelLike & { posted: unknown[] };

function createMemoryHub() {
  const portsByName = new Map<string, Set<MemoryPort>>();
  function createPort(name: string): MemoryPort {
    let peers = portsByName.get(name);
    if (!peers) {
      peers = new Set();
      portsByName.set(name, peers);
    }
    const port: MemoryPort = {
      posted: [],
      onmessage: null,
      postMessage(data: unknown) {
        port.posted.push(data);
        for (const peer of peers) {
          if (peer !== port) peer.onmessage?.({ data });
        }
      },
      close() {
        peers.delete(port);
      },
    };
    peers.add(port);
    return port;
  }
  return { createPort };
}

describe("createBroadcastBridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("bridges published events to another context and prevents echo", async () => {
    const hub = createMemoryHub();
    const busA = makeBus();
    const busB = makeBus();
    const portsA: MemoryPort[] = [];
    const portsB: MemoryPort[] = [];
    const bridgeA = createBroadcastBridge(busA, {
      channels: ["cart:add"],
      channelFactory: (name) => {
        const port = hub.createPort(name);
        portsA.push(port);
        return port;
      },
    });
    const bridgeB = createBroadcastBridge(busB, {
      channels: ["cart:add"],
      channelFactory: (name) => {
        const port = hub.createPort(name);
        portsB.push(port);
        return port;
      },
    });
    expect(bridgeA.status).toBe("active");

    const localHandler = vi.fn();
    const remoteHandler = vi.fn();
    busA.subscribe("cart:add", localHandler, { subscriber: "page-product" });
    busB.subscribe("cart:add", remoteHandler, { subscriber: "page-product" });

    await busA.publish(
      "cart:add",
      { productId: "p-7" },
      { owner: "fragment-recommendation-widget" },
    );
    await Promise.resolve();

    expect(localHandler).toHaveBeenCalledTimes(1);
    expect(remoteHandler).toHaveBeenCalledTimes(1);
    expect(remoteHandler).toHaveBeenCalledWith(
      { productId: "p-7" },
      { channel: "cart:add", owner: "fragment-recommendation-widget" },
    );
    // Echo prevention: the receiving side must not re-broadcast the message.
    expect(portsA[0].posted).toHaveLength(1);
    expect(portsB[0].posted).toHaveLength(0);

    bridgeA.close();
    bridgeB.close();
  });

  it("only bridges the configured channels", async () => {
    const hub = createMemoryHub();
    const busA = makeBus();
    const busB = makeBus();
    createBroadcastBridge(busA, {
      channels: ["cart:add"],
      channelFactory: (name) => hub.createPort(name),
    });
    createBroadcastBridge(busB, {
      channels: ["cart:add"],
      channelFactory: (name) => hub.createPort(name),
    });
    const handler = vi.fn();
    busB.subscribe("filter:change", handler, {
      subscriber: "fragment-recommendation-widget",
    });
    await busA.publish("filter:change", { q: "x" }, { owner: "page-home" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects bridging channels that are not declared on the bus", () => {
    const hub = createMemoryHub();
    expect(() =>
      createBroadcastBridge(makeBus(), {
        channels: ["unknown:channel"],
        channelFactory: (name) => hub.createPort(name),
      }),
    ).toThrow(InteractionContractError);
  });

  it("ignores malformed or contract-violating remote messages", async () => {
    const hub = createMemoryHub();
    const bus = makeBus();
    createBroadcastBridge(bus, {
      channels: ["cart:add"],
      channelFactory: (name) => hub.createPort(name),
    });
    const foreign = hub.createPort("cart:add");
    const handler = vi.fn();
    bus.subscribe("cart:add", handler, { subscriber: "page-product" });

    foreign.postMessage("garbage");
    foreign.postMessage({
      kind: "mvp-interaction",
      sourceId: "other",
      channel: "cart:add",
      owner: "not-the-publisher",
      payload: { productId: "p-1" },
    });
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
  });

  it("degrades to a no-op bridge when BroadcastChannel is unavailable", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const bus = makeBus();
    const bridge = createBroadcastBridge(bus, { channels: ["cart:add"] });
    expect(bridge.status).toBe("disabled");
    expect(bridge.channels).toEqual([]);
    // Local publishing keeps working.
    const handler = vi.fn();
    bus.subscribe("cart:add", handler, { subscriber: "page-product" });
    await bus.publish(
      "cart:add",
      { productId: "p-1" },
      { owner: "fragment-recommendation-widget" },
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(() => bridge.close()).not.toThrow();
  });

  it("uses the global BroadcastChannel constructor by default", () => {
    const instances: Array<{ name: string }> = [];
    class FakeBroadcastChannel {
      name: string;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      constructor(name: string) {
        this.name = name;
        instances.push(this);
      }
      postMessage() {}
      close() {}
    }
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const bridge = createBroadcastBridge(makeBus(), {
      channels: ["cart:add"],
    });
    expect(bridge.status).toBe("active");
    expect(instances.map((instance) => instance.name)).toEqual(["cart:add"]);
    bridge.close();
  });
});
