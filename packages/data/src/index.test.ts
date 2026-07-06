import type { DataDependency, RequestContext } from "@mvp/contracts";
import { createRequestTrace } from "@mvp/observability";
import { describe, expect, it, vi } from "vitest";
import {
  createDataClient,
  createDataKey,
  DataDependencyError,
  defineDataSource,
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

describe("@mvp/data", () => {
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

  it("allows subscriptions only for near-realtime and realtime dependencies", () => {
    const realtime = defineDataSource({
      id: "ticker",
      dependency: {
        id: "ticker",
        owner: "client-island",
        source: "subscription",
        freshness: "realtime",
        privacy: "public",
        invalidationTags: [],
        dependsOn: [],
      },
      load: async () => null,
    });
    const client = createDataClient({ ctx, sources: [realtime] });
    const handler = vi.fn();
    const unsubscribe = client.subscribeData("ticker", handler);
    expect(handler).toHaveBeenCalledWith({ sourceId: "ticker", ctx });
    expect(unsubscribe()).toBeUndefined();
  });

  it("creates stable partitioned data keys", () => {
    expect(createDataKey(productDependency, ctx, { b: 2, a: 1 })).toBe(
      createDataKey(productDependency, ctx, { a: 1, b: 2 }),
    );
    expect(createDataKey(productDependency, ctx, {})).toContain("tenant-a");
  });
});
