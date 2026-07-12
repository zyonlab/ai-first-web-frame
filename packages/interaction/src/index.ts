import {
  type InteractionContract,
  InteractionContractSchema,
} from "@mvp/contracts";

/** Raised when a bus operation violates a declared interaction contract. */
export class InteractionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InteractionContractError";
  }
}

/** Raised when a mutation violates its declared contract. */
export class MutationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutationContractError";
  }
}

/** Trace event emitted after each successful publish, for @mvp/observability wiring. */
export type InteractionBusEvent = {
  channel: string;
  owner: string;
  durationMs: number;
  subscriberCount: number;
};

export type InteractionMessage = {
  channel: string;
  payload: unknown;
  owner: string;
};

export type InteractionHandler = (
  payload: unknown,
  meta: { channel: string; owner: string },
) => void | Promise<void>;

/**
 * `C` is the union of channel names this bus knows about (M4 typed channels).
 * It is inferred from the literal `channel` types of the contracts passed to
 * {@link createInteractionBus}; contracts typed as plain `InteractionContract[]`
 * widen `channel` to `string`, so `C` defaults to `string` and every untyped
 * call site keeps compiling unchanged.
 */
export type InteractionBusOptions<C extends string = string> = {
  contracts: ReadonlyArray<InteractionContract & { channel: C }>;
  /** Optional trace hook invoked once per successful publish. */
  onEvent?: (event: InteractionBusEvent) => void;
  /** Injectable clock, used to measure publish duration. */
  now?: () => number;
};

/**
 * The bus surface, generic over its declared channel union `C` (default
 * `string`, so `InteractionBus` written without a type argument is exactly the
 * pre-M4 shape). When `C` is a literal union (contracts declared with `const`
 * channel ids + `satisfies`), publishing/subscribing/looking up a typo'd
 * channel fails at COMPILE time instead of only at runtime.
 *
 * Members are declared with method syntax deliberately: methods are checked
 * bivariantly, so a channel-narrowed `InteractionBus<"a" | "b">` remains
 * assignable wherever a plain `InteractionBus` is expected (island `bus`
 * props, bridges) and vice versa — the narrowing is a call-site check, not an
 * assignability wall.
 */
export type InteractionBus<C extends string = string> = {
  publish(
    channel: C,
    payload: unknown,
    options: { owner: string },
  ): Promise<{ subscriberCount: number }>;
  subscribe(
    channel: C,
    handler: InteractionHandler,
    options: { subscriber: string },
  ): () => void;
  /**
   * Infrastructure-level observer (bridges, devtools). Taps fire synchronously
   * for every published message and bypass subscriber declarations; they are
   * not a substitute for `subscribe`.
   */
  tap(listener: (message: InteractionMessage) => void): () => void;
  listChannels(): C[];
  getContract(channel: C): InteractionContract | undefined;
};

type ZodLikeSchema = {
  safeParse: (
    value: unknown,
  ) => { success: true; data: unknown } | { success: false; error: unknown };
};

function isZodLike(schema: unknown): schema is ZodLikeSchema {
  return (
    typeof schema === "object" &&
    schema !== null &&
    typeof (schema as ZodLikeSchema).safeParse === "function"
  );
}

/**
 * Validates a payload against a contract payload schema.
 *
 * `InteractionContract.payloadSchema` is a plain record. Two shapes are
 * supported: a zod-like schema carrying `safeParse` (parsed directly), or a
 * minimal JSON-Schema subset (`type`, `properties`, `required`, `items`,
 * `enum`, `additionalProperties`). An empty record accepts any payload.
 * Returns the (possibly transformed) payload.
 */
export function validateInteractionPayload(
  schema: Record<string, unknown> | undefined,
  payload: unknown,
  context: string,
): unknown {
  if (!schema || Object.keys(schema).length === 0) return payload;
  if (isZodLike(schema)) {
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new InteractionContractError(
        `${context}: payload failed schema validation (${String(result.error)})`,
      );
    }
    return result.data;
  }
  const failure = findSchemaViolation(schema, payload, "payload");
  if (failure) {
    throw new InteractionContractError(`${context}: ${failure}`);
  }
  return payload;
}

function findSchemaViolation(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
): string | undefined {
  const type = schema.type;
  if (typeof type === "string") {
    const typeError = checkType(type, value, path);
    if (typeError) return typeError;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((v) => v === value)) {
    return `${path} is not one of the allowed enum values`;
  }
  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties)
      ? schema.properties
      : undefined;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && !(key in value)) {
          return `${path} is missing required property "${key}"`;
        }
      }
    }
    if (properties) {
      for (const [key, childSchema] of Object.entries(properties)) {
        if (!(key in value) || !isPlainObject(childSchema)) continue;
        const childError = findSchemaViolation(
          childSchema,
          value[key],
          `${path}.${key}`,
        );
        if (childError) return childError;
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in properties)) {
            return `${path} has unexpected additional property "${key}"`;
          }
        }
      }
    }
  }
  if (Array.isArray(value) && isPlainObject(schema.items)) {
    for (let index = 0; index < value.length; index += 1) {
      const itemError = findSchemaViolation(
        schema.items,
        value[index],
        `${path}[${index}]`,
      );
      if (itemError) return itemError;
    }
  }
  return undefined;
}

function checkType(
  type: string,
  value: unknown,
  path: string,
): string | undefined {
  const ok =
    (type === "object" && isPlainObject(value)) ||
    (type === "array" && Array.isArray(value)) ||
    (type === "string" && typeof value === "string") ||
    (type === "number" && typeof value === "number") ||
    (type === "integer" && Number.isInteger(value)) ||
    (type === "boolean" && typeof value === "boolean") ||
    (type === "null" && value === null);
  return ok ? undefined : `${path} must be of type ${type}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Creates a typed event bus over declared `InteractionContract`s.
 *
 * Every channel must be declared up front. Publishing requires the declared
 * publisher identity, subscribing requires a declared subscriber identity,
 * and payloads are validated against the contract payload schema.
 *
 * M4 typed channels: `C` is inferred from the contracts' literal `channel`
 * types. Declare contracts with `const` channel ids and
 * `satisfies ReadonlyArray<InteractionContract>` (NOT a widening
 * `InteractionContract[]` annotation) and the returned `InteractionBus<C>`
 * rejects `publish`/`subscribe`/`getContract` on any channel outside the
 * declared union at compile time. Runtime behavior is unchanged either way.
 */
export function createInteractionBus<C extends string = string>({
  contracts,
  onEvent,
  now = Date.now,
}: InteractionBusOptions<C>): InteractionBus<C> {
  const contractMap = new Map<C, InteractionContract>();
  for (const raw of contracts) {
    const contract = InteractionContractSchema.parse(raw);
    if (contractMap.has(contract.channel as C)) {
      throw new InteractionContractError(
        `duplicate interaction contract for channel "${contract.channel}"`,
      );
    }
    contractMap.set(contract.channel as C, contract);
  }

  const subscriptions = new Map<string, Set<InteractionHandler>>();
  const taps = new Set<(message: InteractionMessage) => void>();

  function requireContract(channel: string): InteractionContract {
    const contract = contractMap.get(channel as C);
    if (!contract) {
      throw new InteractionContractError(
        `channel "${channel}" has no declared interaction contract`,
      );
    }
    return contract;
  }

  async function publish(
    channel: string,
    payload: unknown,
    { owner }: { owner: string },
  ) {
    const contract = requireContract(channel);
    if (owner !== contract.publisher) {
      throw new InteractionContractError(
        `"${owner}" is not the declared publisher of channel "${channel}" (expected "${contract.publisher}")`,
      );
    }
    const validated = validateInteractionPayload(
      contract.payloadSchema,
      payload,
      `channel "${channel}"`,
    );
    // Taps fire synchronously so bridges can rely on re-entrancy guards.
    for (const listener of taps) {
      listener({ channel, payload: validated, owner });
    }
    const start = now();
    const handlers = [...(subscriptions.get(channel) ?? [])];
    await Promise.all(
      handlers.map((handler) => handler(validated, { channel, owner })),
    );
    onEvent?.({
      channel,
      owner,
      durationMs: now() - start,
      subscriberCount: handlers.length,
    });
    return { subscriberCount: handlers.length };
  }

  function subscribe(
    channel: string,
    handler: InteractionHandler,
    { subscriber }: { subscriber: string },
  ) {
    const contract = requireContract(channel);
    if (!contract.subscribers.includes(subscriber)) {
      throw new InteractionContractError(
        `"${subscriber}" is not a declared subscriber of channel "${channel}"`,
      );
    }
    let handlers = subscriptions.get(channel);
    if (!handlers) {
      handlers = new Set();
      subscriptions.set(channel, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  function tap(listener: (message: InteractionMessage) => void) {
    taps.add(listener);
    return () => {
      taps.delete(listener);
    };
  }

  return {
    publish,
    subscribe,
    tap,
    listChannels: () => [...contractMap.keys()],
    getContract: (channel) => contractMap.get(channel),
  };
}

export type MutationIO<TInput, TResult> = {
  /** Performs the actual server mutation (injected to stay decoupled from @mvp/data). */
  mutate: (input: TInput) => TResult | Promise<TResult>;
  /** Invalidates cache tags (e.g. wired to `createDataClient().mutateData`). */
  invalidate: (tags: string[]) => void | Promise<void>;
};

export type MutationDefinition = {
  name: string;
  /** Optional input schema: minimal JSON-Schema record or zod-like `safeParse` carrier. */
  input?: Record<string, unknown>;
  /** The complete set of cache tags this mutation is allowed to invalidate. */
  invalidates: string[];
};

export type Mutation<TInput, TResult> = {
  name: string;
  invalidates: string[];
  execute: (
    input: TInput,
    io: MutationIO<TInput, TResult>,
    options?: { invalidates?: string[] },
  ) => Promise<{ result: TResult; invalidated: string[] }>;
};

/**
 * Declares a server mutation contract. `execute` validates the input, runs
 * the injected `mutate`, then invalidates the declared tags through the
 * injected `invalidate` callback. Only declared tags may ever be invalidated;
 * requesting an undeclared tag throws before any invalidation happens.
 */
export function defineMutation<TInput = unknown, TResult = unknown>(
  definition: MutationDefinition,
): Mutation<TInput, TResult> {
  const declared = [...definition.invalidates];
  return {
    name: definition.name,
    invalidates: declared,
    async execute(input, io, options) {
      const tags = options?.invalidates ?? declared;
      const undeclared = tags.filter((tag) => !declared.includes(tag));
      if (undeclared.length > 0) {
        throw new MutationContractError(
          `mutation "${definition.name}" cannot invalidate undeclared tags: ${undeclared.join(", ")}`,
        );
      }
      let validated: unknown = input;
      if (definition.input) {
        try {
          validated = validateInteractionPayload(
            definition.input,
            input,
            `mutation "${definition.name}"`,
          );
        } catch (error) {
          throw new MutationContractError(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      const result = await io.mutate(validated as TInput);
      await io.invalidate(tags);
      return { result, invalidated: tags };
    },
  };
}

/** Minimal structural subset of the DOM BroadcastChannel interface. */
export type BroadcastChannelLike = {
  postMessage: (data: unknown) => void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close: () => void;
};

export type BroadcastBridgeOptions<C extends string = string> = {
  /** Channels to bridge. Defaults to every channel declared on the bus. */
  channels?: ReadonlyArray<C>;
  /**
   * Creates the transport for one channel. Defaults to the global
   * `BroadcastChannel` constructor; when neither is available the bridge
   * degrades to an inert no-op with `status: "disabled"`.
   */
  channelFactory?: (name: string) => BroadcastChannelLike | undefined;
};

export type BroadcastBridge = {
  status: "active" | "disabled";
  /** Channels actually bridged (empty when disabled). */
  channels: string[];
  close: () => void;
};

type BridgeWireMessage = {
  kind: "mvp-interaction";
  sourceId: string;
  channel: string;
  owner: string;
  payload: unknown;
};

function isBridgeWireMessage(data: unknown): data is BridgeWireMessage {
  return (
    isPlainObject(data) &&
    data.kind === "mvp-interaction" &&
    typeof data.sourceId === "string" &&
    typeof data.channel === "string" &&
    typeof data.owner === "string"
  );
}

function defaultChannelFactory():
  | ((name: string) => BroadcastChannelLike)
  | undefined {
  const ctor = (
    globalThis as {
      BroadcastChannel?: new (name: string) => BroadcastChannelLike;
    }
  ).BroadcastChannel;
  if (typeof ctor !== "function") return undefined;
  return (name) => new ctor(name);
}

/**
 * Bridges bus channels across execution contexts (tabs, workers) over a
 * BroadcastChannel-style transport. Messages arriving from the transport are
 * republished locally with their original owner and are never re-broadcast
 * (echo prevention). Remote messages that fail contract validation are
 * dropped silently.
 */
export function createBroadcastBridge<C extends string = string>(
  bus: InteractionBus<C>,
  // NoInfer: the channel union comes from the bus alone, so a typo'd entry in
  // `options.channels` is a compile error instead of widening the inference.
  options: BroadcastBridgeOptions<NoInfer<C>> = {},
): BroadcastBridge {
  const channels = options.channels ?? bus.listChannels();
  for (const channel of channels) {
    if (!bus.getContract(channel)) {
      throw new InteractionContractError(
        `cannot bridge undeclared channel "${channel}"`,
      );
    }
  }

  const factory = options.channelFactory ?? defaultChannelFactory();
  if (!factory || channels.length === 0) {
    return { status: "disabled", channels: [], close: () => undefined };
  }

  const sourceId = `bridge-${Math.random().toString(36).slice(2)}`;
  const ports = new Map<string, BroadcastChannelLike>();
  let receiving = false;

  for (const channel of channels) {
    const port = factory(channel);
    if (!port) continue;
    port.onmessage = (event) => {
      const data = event.data;
      if (!isBridgeWireMessage(data)) return;
      if (data.sourceId === sourceId || data.channel !== channel) return;
      receiving = true;
      try {
        // Contract violations from remote contexts are dropped, not thrown.
        // `data.channel` arrives as a bare string off the wire; the guard
        // above pinned it to this port's (declared) channel, so the cast to
        // the bus's channel union is safe.
        void bus
          .publish(data.channel as C, data.payload, { owner: data.owner })
          .catch(() => undefined);
      } finally {
        receiving = false;
      }
    };
    ports.set(channel, port);
  }

  if (ports.size === 0) {
    return { status: "disabled", channels: [], close: () => undefined };
  }

  const untap = bus.tap(({ channel, payload, owner }) => {
    if (receiving) return;
    const port = ports.get(channel);
    if (!port) return;
    const message: BridgeWireMessage = {
      kind: "mvp-interaction",
      sourceId,
      channel,
      owner,
      payload,
    };
    port.postMessage(message);
  });

  return {
    status: "active",
    channels: [...ports.keys()],
    close: () => {
      untap();
      for (const port of ports.values()) {
        port.onmessage = null;
        port.close();
      }
      ports.clear();
    },
  };
}
