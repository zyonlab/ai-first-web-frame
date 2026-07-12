import type { DataDependency, RequestContext } from "@mvp/contracts";
import { createRequestTrace } from "@mvp/observability";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  type CacheAdapter,
  createDataClient,
  createDataKey,
  createMemorySubscriptionTransport,
  type DataCacheEntry,
  DataDependencyError,
  defineDataSource,
  MemoryCacheAdapter,
} from "./index";

const ctx: RequestContext = {
  traceId: "trace-data",
  requestId: "req-data",
  locale: "en-US",
  tenant: "tenant-a",
  featureFlags: {},
  experiment: { bucket: "a" },
  theme: "system",
  device: "desktop",
  user: { id: "user-1" },
  userAgent: "vitest",
  timestamp: new Date("2026-01-01T00:00:00.000Z").toISOString(),
};

const productDependency: DataDependency = {
  id: "product",
  owner: "page",
  source: "api",
  freshness: "isr",
  privacy: "tenant",
  cachePolicy: {
    ttl: 60,
    tags: ["product"],
    vary: ["tenant", "locale", "props"],
  },
  invalidationTags: ["product:123"],
  dependsOn: [],
};

const tickerDependency: DataDependency = {
  id: "ticker",
  owner: "client-island",
  source: "subscription",
  freshness: "realtime",
  privacy: "public",
  invalidationTags: ["ticker:latest"],
  dependsOn: [],
};

const statsDependency: DataDependency = {
  id: "stats",
  owner: "client-island",
  source: "api",
  freshness: "near-realtime",
  privacy: "tenant",
  cachePolicy: { ttl: 60, tags: ["stats"], vary: ["tenant", "props"] },
  invalidationTags: ["stats:latest"],
  dependsOn: [],
};

describe("@mvp/data", () => {
  it("rejects a dependency violating DataDependencySchema invariants at definition time", () => {
    // M2: the superRefine rules ("subscription sources must be realtime", ...)
    // used to be type-level only; defineDataSource now actually runs them.
    expect(() =>
      defineDataSource({
        id: "broken-subscription",
        dependency: {
          id: "broken-subscription",
          owner: "client-island",
          source: "subscription",
          freshness: "static",
          privacy: "public",
          invalidationTags: [],
          dependsOn: [],
        },
        load: async () => ({}),
      }),
    ).toThrow(/DataDependencySchema.*subscription sources must be realtime/);
  });

  it("dedupes concurrent SSR reads with the same dependency key", async () => {
    const load = vi.fn(async () => ({ id: "123", title: "Pack" }));
    const source = defineDataSource({
      id: "product",
      dependency: productDependency,
      load,
    });
    const client = createDataClient({ ctx, sources: [source] });
    const [first, second] = await Promise.all([
      client.readData("product", { id: "123" }),
      client.readData("product", { id: "123" }),
    ]);
    expect(first.data).toEqual(second.data);
    expect(second.source).toBe("pending");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("caches ttl-backed data and invalidates by tag", async () => {
    let version = 0;
    const source = defineDataSource({
      id: "product",
      dependency: productDependency,
      load: async () => ({ version: ++version }),
    });
    const client = createDataClient({ ctx, sources: [source] });
    const first = await client.readData("product", { id: "123" });
    const second = await client.readData("product", { id: "123" });
    client.mutateData("product:123");
    const third = await client.readData("product", { id: "123" });
    expect(first.data).toEqual({ version: 1 });
    expect(second.source).toBe("cache");
    expect(third.data).toEqual({ version: 2 });
  });

  it("keeps the legacy Map cache option readable by callers", async () => {
    const legacyCache = new Map<string, DataCacheEntry>();
    const source = defineDataSource({
      id: "product",
      dependency: productDependency,
      load: async () => ({ id: "123" }),
    });
    const client = createDataClient({
      ctx,
      sources: [source],
      cache: legacyCache,
    });
    const result = await client.readData("product", { id: "123" });
    expect(legacyCache.get(result.key)?.data).toEqual({ id: "123" });
    const cached = await client.readData("product", { id: "123" });
    expect(cached.source).toBe("cache");
  });

  it("accepts a custom async CacheAdapter", async () => {
    const store = new Map<string, DataCacheEntry>();
    const adapter: CacheAdapter = {
      get: async (key) => store.get(key),
      set: async (key, entry) => void store.set(key, entry),
      delete: async (key) => void store.delete(key),
      invalidateTags: async (tags) => {
        for (const [key, entry] of store.entries()) {
          if (entry.tags.some((tag) => tags.includes(tag))) store.delete(key);
        }
      },
      clear: async () => store.clear(),
    };
    let version = 0;
    const source = defineDataSource({
      id: "product",
      dependency: productDependency,
      load: async () => ({ version: ++version }),
    });
    const client = createDataClient({ ctx, sources: [source], cache: adapter });
    await client.readData("product", { id: "123" });
    const cached = await client.readData("product", { id: "123" });
    expect(cached.source).toBe("cache");
    expect(cached.data).toEqual({ version: 1 });
    await client.mutateData("product:123");
    const reloaded = await client.readData("product", { id: "123" });
    expect(reloaded.data).toEqual({ version: 2 });
  });

  it("records data trace spans", async () => {
    const trace = createRequestTrace({ traceId: "trace-data" });
    const source = defineDataSource({
      id: "product",
      dependency: productDependency,
      load: async () => ({ id: "123" }),
    });
    const client = createDataClient({ ctx, sources: [source], trace });
    await client.readData("product", { id: "123" });
    expect(trace.toDependencyGraphLog()).toContain("data:product");
  });

  it("rejects unknown and client-local data sources during SSR", async () => {
    const client = createDataClient({ ctx, sources: [] });
    await expect(client.readData("missing")).rejects.toThrow(
      DataDependencyError,
    );
    const source = defineDataSource({
      id: "local",
      dependency: {
        ...productDependency,
        id: "local",
        freshness: "client-local",
      },
      load: async () => "local",
    });
    await expect(
      createDataClient({ ctx, sources: [source] }).readData("local"),
    ).rejects.toThrow("client-local data cannot be read during SSR");
  });

  it("returns loader data unchanged when responseSchema accepts the payload", async () => {
    const source = defineDataSource({
      id: "product",
      dependency: productDependency,
      responseSchema: z
        .object({ sku: z.string(), price: z.number() })
        .describe("ProductPayloadSchema"),
      load: async () => ({ sku: "sku-1", price: 10 }),
    });
    const client = createDataClient({ ctx, sources: [source] });
    const result = await client.readData("product");
    expect(result.data).toEqual({ sku: "sku-1", price: 10 });
    expect(result.source).toBe("loader");
  });

  it("throws DataDependencyError naming the responseSchema on a mismatched payload", async () => {
    const source = defineDataSource({
      id: "product",
      dependency: productDependency,
      responseSchema: z
        .object({ sku: z.string(), price: z.number() })
        .describe("ProductPayloadSchema"),
      // Upstream shape drift: price became a string.
      load: async () => ({ sku: "sku-1", price: "10" }) as never,
    });
    const client = createDataClient({ ctx, sources: [source] });
    await expect(client.readData("product")).rejects.toThrow(
      DataDependencyError,
    );
    await expect(client.readData("product")).rejects.toThrow(
      /"product" response violates ProductPayloadSchema — price:/,
    );
  });

  it("never caches a payload rejected by responseSchema", async () => {
    const cache = new Map<string, DataCacheEntry>();
    const source = defineDataSource({
      id: "product",
      dependency: productDependency,
      responseSchema: z.object({ sku: z.string() }).describe("ProductSchema"),
      load: async () => ({ sku: 7 }) as never,
    });
    const client = createDataClient({ ctx, sources: [source], cache });
    await expect(client.readData("product")).rejects.toThrow(
      DataDependencyError,
    );
    expect(cache.size).toBe(0);
  });

  it("creates stable partitioned data keys", () => {
    expect(createDataKey(productDependency, ctx, { b: 2, a: 1 })).toBe(
      createDataKey(productDependency, ctx, { a: 1, b: 2 }),
    );
    expect(createDataKey(productDependency, ctx, {})).toContain("tenant-a");
  });

  describe("subscribeData", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("allows subscriptions only for near-realtime and realtime dependencies", () => {
      const source = defineDataSource({
        id: "product",
        dependency: productDependency,
        load: async () => null,
      });
      const client = createDataClient({ ctx, sources: [source] });
      expect(() => client.subscribeData("product", vi.fn())).toThrow(
        DataDependencyError,
      );
      expect(() => client.subscribeData("missing", vi.fn())).toThrow(
        DataDependencyError,
      );
    });

    it("polls near-realtime sources and notifies only on change", async () => {
      let value = 1;
      const load = vi.fn(async () => ({ value }));
      const source = defineDataSource({
        id: "stats",
        dependency: statsDependency,
        load,
      });
      const client = createDataClient({ ctx, sources: [source] });
      const handler = vi.fn();
      const unsubscribe = client.subscribeData("stats", handler, {
        intervalMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sourceId: "stats",
          data: { value: 1 },
          ctx,
        }),
      );

      await vi.advanceTimersByTimeAsync(1000);
      expect(handler).toHaveBeenCalledTimes(1);

      value = 2;
      await vi.advanceTimersByTimeAsync(1000);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: { value: 2 } }),
      );

      unsubscribe();
      value = 3;
      await vi.advanceTimersByTimeAsync(5000);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(load).toHaveBeenCalledTimes(3);
    });

    it("writes polled values into the cache for subsequent reads", async () => {
      const cache = new MemoryCacheAdapter();
      let value = 1;
      const load = vi.fn(async () => ({ value }));
      const source = defineDataSource({
        id: "stats",
        dependency: statsDependency,
        load,
      });
      const client = createDataClient({ ctx, sources: [source], cache });
      const unsubscribe = client.subscribeData("stats", vi.fn(), {
        intervalMs: 1000,
      });

      value = 2;
      await vi.advanceTimersByTimeAsync(1000);
      unsubscribe();

      const result = await client.readData("stats");
      expect(result.source).toBe("cache");
      expect(result.data).toEqual({ value: 2 });
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("keeps polling after a transient load failure", async () => {
      let shouldFail = true;
      const trace = createRequestTrace({ traceId: "trace-data" });
      const source = defineDataSource({
        id: "stats",
        dependency: statsDependency,
        load: async () => {
          if (shouldFail) throw new Error("boom");
          return { value: 9 };
        },
      });
      const client = createDataClient({ ctx, sources: [source], trace });
      const handler = vi.fn();
      const unsubscribe = client.subscribeData("stats", handler, {
        intervalMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(handler).not.toHaveBeenCalled();

      shouldFail = false;
      await vi.advanceTimersByTimeAsync(1000);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(trace.toDependencyGraphLog()).toContain("data:stats");
      unsubscribe();
    });

    it("delivers realtime transport messages and dedupes repeats", async () => {
      const trace = createRequestTrace({ traceId: "trace-data" });
      const transport = createMemorySubscriptionTransport();
      const source = defineDataSource({
        id: "ticker",
        dependency: tickerDependency,
        load: async () => null,
      });
      const client = createDataClient({ ctx, sources: [source], trace });
      const handler = vi.fn();
      const unsubscribe = client.subscribeData("ticker", handler, {
        transport,
      });
      expect(transport.connected).toBe(true);

      transport.publish({ price: 1 });
      await vi.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenLastCalledWith(
        expect.objectContaining({ sourceId: "ticker", data: { price: 1 } }),
      );

      transport.publish({ price: 1 });
      await vi.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalledTimes(1);

      transport.publish({ price: 2 });
      await vi.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(trace.toDependencyGraphLog()).toContain("data:ticker");

      unsubscribe();
      expect(transport.connected).toBe(false);
      transport.publish({ price: 3 });
      await vi.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("invalidates entries sharing the dependency invalidation tags", async () => {
      const cache = new MemoryCacheAdapter();
      cache.set("stale-entry", {
        data: { value: "old" },
        expiresAt: Number.MAX_SAFE_INTEGER,
        tags: ["ticker:latest"],
      });
      const transport = createMemorySubscriptionTransport();
      const source = defineDataSource({
        id: "ticker",
        dependency: tickerDependency,
        load: async () => null,
      });
      const client = createDataClient({ ctx, sources: [source], cache });
      const unsubscribe = client.subscribeData("ticker", vi.fn(), {
        transport,
      });

      transport.publish({ price: 42 });
      await vi.advanceTimersByTimeAsync(0);

      expect(cache.get("stale-entry")).toBeUndefined();
      // realtime data must never be ttl-cached
      expect(cache.store.size).toBe(0);
      unsubscribe();
    });
  });
});
