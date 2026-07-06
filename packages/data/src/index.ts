import type {
  DataDependency,
  DataFreshness,
  RequestContext,
} from "@mvp/contracts";
import type { RequestTrace } from "@mvp/observability";

export type DataLoaderInput<TParams> = {
  ctx: RequestContext;
  params: TParams;
  signal?: AbortSignal;
};

export type DataSource<TData = unknown, TParams = Record<string, unknown>> = {
  id: string;
  dependency: DataDependency;
  load: (input: DataLoaderInput<TParams>) => TData | Promise<TData>;
};

export type DataReadResult<TData> = {
  data: TData;
  source: "loader" | "cache" | "pending";
  key: string;
  dependency: DataDependency;
};

export type DataCacheEntry = {
  expiresAt: number;
  data: unknown;
  tags: string[];
};

/**
 * Pluggable cache backend for the data client.
 *
 * Every method may be synchronous or return a promise, so the same interface
 * covers the in-process default as well as remote backends. Implementations
 * for Redis, a CDN cache API, or any shared multi-instance store only need to
 * satisfy this contract:
 *
 * - `get`/`set`/`delete` operate on fully-partitioned data keys (see
 *   {@link createDataKey}); keys already encode tenant/user/experiment
 *   partitions, so adapters never need privacy-specific logic.
 * - `invalidateTags` must evict every entry whose `tags` intersect the given
 *   list. Remote adapters typically map this to tag-indexed deletes
 *   (e.g. Redis sets per tag, CDN surrogate keys).
 * - `clear` drops everything owned by the adapter.
 */
export type CacheAdapter = {
  get: (
    key: string,
  ) => DataCacheEntry | undefined | Promise<DataCacheEntry | undefined>;
  set: (key: string, entry: DataCacheEntry) => void | Promise<void>;
  delete: (key: string) => void | Promise<void>;
  invalidateTags: (tags: string[]) => void | Promise<void>;
  clear: () => void | Promise<void>;
};

/**
 * Default in-process cache adapter backed by a plain Map. Passing an existing
 * Map keeps the legacy `options.cache: Map` behaviour: the map stays readable
 * and writable by the caller.
 */
export class MemoryCacheAdapter implements CacheAdapter {
  readonly store: Map<string, DataCacheEntry>;

  constructor(store: Map<string, DataCacheEntry> = new Map()) {
    this.store = store;
  }

  get(key: string) {
    return this.store.get(key);
  }

  set(key: string, entry: DataCacheEntry) {
    this.store.set(key, entry);
  }

  delete(key: string) {
    this.store.delete(key);
  }

  invalidateTags(tags: string[]) {
    if (tags.length === 0) return;
    for (const [key, entry] of this.store.entries()) {
      if (entry.tags.some((tag) => tags.includes(tag))) this.store.delete(key);
    }
  }

  clear() {
    this.store.clear();
  }
}

/**
 * Transport plug for realtime subscriptions. The built-in polling mode covers
 * near-realtime revalidation; a WebSocket or SSE transport implements this
 * interface and pushes decoded payloads through `onMessage` listeners.
 */
export type SubscriptionTransport = {
  connect: (options: {
    sourceId: string;
    key: string;
    dependency: DataDependency;
    ctx: RequestContext;
  }) => void | Promise<void>;
  onMessage: (listener: (data: unknown) => void) => void;
  close: () => void | Promise<void>;
};

export type MemorySubscriptionTransport = SubscriptionTransport & {
  /** Delivers a payload to the subscriber, as a WebSocket message would. */
  publish: (data: unknown) => void;
  readonly connected: boolean;
};

/**
 * In-memory transport for tests and demos. Messages published before
 * `connect` or after `close` are dropped.
 */
export function createMemorySubscriptionTransport(): MemorySubscriptionTransport {
  const listeners = new Set<(data: unknown) => void>();
  let connected = false;

  return {
    get connected() {
      return connected;
    },
    connect() {
      connected = true;
    },
    onMessage(listener) {
      listeners.add(listener);
    },
    close() {
      connected = false;
      listeners.clear();
    },
    publish(data) {
      if (!connected) return;
      for (const listener of listeners) listener(data);
    },
  };
}

export type DataSubscriptionEvent<TData = unknown> = {
  sourceId: string;
  key: string;
  data: TData;
  ctx: RequestContext;
};

export type SubscribeDataOptions<TParams = Record<string, unknown>> = {
  params?: TParams;
  /** Poll interval override; defaults by freshness (realtime 1s, near-realtime 5s). */
  intervalMs?: number;
  /** Push transport (WebSocket/SSE/in-memory). Disables polling when set. */
  transport?: SubscriptionTransport;
};

export type DataClientOptions = {
  ctx: RequestContext;
  sources: Array<DataSource>;
  /** Legacy Map storage or any {@link CacheAdapter} (Redis, CDN, ...). */
  cache?: Map<string, DataCacheEntry> | CacheAdapter;
  trace?: RequestTrace;
  now?: () => number;
};

export class DataDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataDependencyError";
  }
}

const DEFAULT_SUBSCRIPTION_INTERVAL_MS: Partial<Record<DataFreshness, number>> =
  {
    realtime: 1_000,
    "near-realtime": 5_000,
  };

export function defineDataSource<TData, TParams = Record<string, unknown>>(
  source: DataSource<TData, TParams>,
) {
  return source;
}

function toCacheAdapter(
  cache: Map<string, DataCacheEntry> | CacheAdapter | undefined,
): CacheAdapter {
  if (!cache) return new MemoryCacheAdapter();
  if (cache instanceof Map) return new MemoryCacheAdapter(cache);
  return cache;
}

export function createDataClient({
  ctx,
  sources,
  cache,
  trace,
  now = Date.now,
}: DataClientOptions) {
  const cacheAdapter = toCacheAdapter(cache);
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const pending = new Map<string, Promise<DataReadResult<unknown>>>();

  async function readData<TData = unknown, TParams = Record<string, unknown>>(
    sourceId: string,
    params = {} as TParams,
  ): Promise<DataReadResult<TData>> {
    const source = sourceMap.get(sourceId) as
      | DataSource<TData, TParams>
      | undefined;
    if (!source)
      throw new DataDependencyError(`data source "${sourceId}" not found`);
    validateRuntimeFreshness(source.dependency.freshness);
    const key = createDataKey(source.dependency, ctx, params);

    const cached = await cacheAdapter.get(key);
    if (cached && cached.expiresAt > now()) {
      const spanId = trace?.startSpan(`data:${sourceId}`, "data", {
        attributes: {
          key,
          source: "cache",
          freshness: source.dependency.freshness,
        },
      });
      trace?.endSpan(spanId ?? "", { status: "cache" });
      return {
        data: cached.data as TData,
        source: "cache",
        key,
        dependency: source.dependency,
      };
    }

    const existing = pending.get(key);
    if (existing) {
      const result = (await existing) as DataReadResult<TData>;
      return { ...result, source: "pending" };
    }

    const loadPromise = loadData(source, params, key);
    pending.set(key, loadPromise as Promise<DataReadResult<unknown>>);
    try {
      return await loadPromise;
    } finally {
      pending.delete(key);
    }
  }

  function preloadData<TParams = Record<string, unknown>>(
    sourceId: string,
    params = {} as TParams,
  ) {
    void readData(sourceId, params);
  }

  function mutateData(tagOrKey: string): Promise<void> {
    // Both adapter calls are issued synchronously so legacy fire-and-forget
    // callers with the in-memory adapter observe the invalidation immediately.
    const deleted = cacheAdapter.delete(tagOrKey);
    const invalidated = cacheAdapter.invalidateTags([tagOrKey]);
    return Promise.all([deleted, invalidated]).then(() => undefined);
  }

  function subscribeData<TData = unknown, TParams = Record<string, unknown>>(
    sourceId: string,
    handler: (event: DataSubscriptionEvent<TData>) => void,
    options: SubscribeDataOptions<TParams> = {},
  ): () => void {
    const source = sourceMap.get(sourceId) as
      | DataSource<TData, TParams>
      | undefined;
    if (!source)
      throw new DataDependencyError(`data source "${sourceId}" not found`);
    const subscribedSource = source;
    const freshness = subscribedSource.dependency.freshness;
    if (freshness !== "realtime" && freshness !== "near-realtime")
      throw new DataDependencyError(
        `data source "${sourceId}" is not subscribable`,
      );

    const params = options.params ?? ({} as TParams);
    const key = createDataKey(subscribedSource.dependency, ctx, params);
    let active = true;
    let lastSerialized: string | undefined;

    async function deliver(data: TData) {
      const serialized = stableStringify(data);
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      await writeSubscriptionCache(subscribedSource.dependency, key, data, {
        adapter: cacheAdapter,
        now,
      });
      if (!active) return;
      const spanId = trace?.startSpan(`data:${sourceId}`, "data", {
        attributes: { key, source: "subscription", freshness },
      });
      trace?.endSpan(spanId ?? "", { status: "ok" });
      handler({ sourceId, key, data, ctx });
    }

    if (options.transport) {
      const transport = options.transport;
      transport.onMessage((data) => {
        if (!active) return;
        void deliver(data as TData);
      });
      void transport.connect({
        sourceId,
        key,
        dependency: subscribedSource.dependency,
        ctx,
      });
      return () => {
        active = false;
        void transport.close();
      };
    }

    const intervalMs =
      options.intervalMs ??
      DEFAULT_SUBSCRIPTION_INTERVAL_MS[freshness] ??
      5_000;
    let polling = false;

    async function poll() {
      if (!active || polling) return;
      polling = true;
      try {
        const data = await subscribedSource.load({ ctx, params });
        if (active) await deliver(data);
      } catch (error) {
        const spanId = trace?.startSpan(`data:${sourceId}`, "data", {
          attributes: { key, source: "subscription", freshness },
        });
        trace?.endSpan(spanId ?? "", {
          status: "error",
          attributes: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      } finally {
        polling = false;
      }
    }

    const timer = setInterval(() => void poll(), intervalMs);
    void poll();

    return () => {
      active = false;
      clearInterval(timer);
    };
  }

  async function loadData<TData, TParams>(
    source: DataSource<TData, TParams>,
    params: TParams,
    key: string,
  ): Promise<DataReadResult<TData>> {
    const spanId = trace?.startSpan(`data:${source.id}`, "data", {
      attributes: {
        key,
        source: "loader",
        freshness: source.dependency.freshness,
        privacy: source.dependency.privacy,
      },
    });
    try {
      const data = await source.load({ ctx, params });
      const ttl = source.dependency.cachePolicy?.ttl ?? 0;
      if (ttl > 0 && source.dependency.freshness !== "realtime") {
        await cacheAdapter.set(key, {
          data,
          expiresAt: now() + ttl * 1000,
          tags: cacheTagsForDependency(source.dependency),
        });
      }
      trace?.endSpan(spanId ?? "", { status: "ok" });
      return { data, source: "loader", key, dependency: source.dependency };
    } catch (error) {
      trace?.endSpan(spanId ?? "", {
        status: "error",
        attributes: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  return {
    readData,
    preloadData,
    mutateData,
    subscribeData,
  };
}

function cacheTagsForDependency(dependency: DataDependency): string[] {
  return [
    ...(dependency.cachePolicy?.tags ?? []),
    ...dependency.invalidationTags,
  ];
}

/**
 * Persists a subscription payload: stale entries sharing the dependency's
 * invalidation tags are evicted first so tag-consistent readers never see a
 * mix of old and new values, then the fresh value is cached when the
 * dependency allows ttl caching (realtime never does, per contract).
 */
async function writeSubscriptionCache(
  dependency: DataDependency,
  key: string,
  data: unknown,
  { adapter, now }: { adapter: CacheAdapter; now: () => number },
): Promise<void> {
  if (dependency.invalidationTags.length > 0) {
    await adapter.invalidateTags(dependency.invalidationTags);
  }
  const ttl = dependency.cachePolicy?.ttl ?? 0;
  if (ttl > 0 && dependency.freshness !== "realtime") {
    await adapter.set(key, {
      data,
      expiresAt: now() + ttl * 1000,
      tags: cacheTagsForDependency(dependency),
    });
  }
}

export function createDataKey(
  dependency: DataDependency,
  ctx: RequestContext,
  params: unknown,
) {
  const parts: Record<string, unknown> = {
    id: dependency.id,
    freshness: dependency.freshness,
    params,
  };
  if (dependency.privacy !== "public") parts.tenant = ctx.tenant;
  if (dependency.privacy === "user-segment") parts.experiment = ctx.experiment;
  if (dependency.privacy === "user-private") parts.user = ctx.user?.id;
  return stableStringify(parts);
}

export function validateRuntimeFreshness(freshness: DataFreshness) {
  if (freshness === "client-local")
    throw new DataDependencyError(
      "client-local data cannot be read during SSR",
    );
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// Mock realtime transport, seeded frame generators, and deterministic fixtures
// (A0-mock slot). See `./transport` for the full surface; this only re-exports.
export * from "./transport";
