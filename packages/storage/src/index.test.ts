import { describe, expect, it } from "vitest";
import {
  canUseSharedStorage,
  createCookiePolicy,
  createCookiePolicyForStorage,
  createCookieStorageAdapter,
  createMemoryStorageAdapter,
  createServerKvStorageAdapter,
  createStorage,
  createStorageKey,
  createWebStorageAdapter,
  parseCookieHeader,
  requiredPartitionKeysForPrivacy,
  resolveStoragePartition,
  StoragePolicyError,
  validateStoragePolicy,
  type WebStorageBackend,
} from "./index";

const ctx = {
  tenant: "tenant-a",
  locale: "en-US",
  theme: "dark" as const,
  device: "desktop" as const,
  user: { id: "user-1" },
};

describe("@mvp/storage", () => {
  it("maps privacy classes to required partition keys", () => {
    expect(requiredPartitionKeysForPrivacy("public")).toEqual([]);
    expect(requiredPartitionKeysForPrivacy("tenant")).toEqual(["tenant"]);
    expect(requiredPartitionKeysForPrivacy("user-segment")).toEqual([
      "tenant",
      "locale",
    ]);
    expect(requiredPartitionKeysForPrivacy("user-private")).toEqual([
      "tenant",
      "user",
    ]);
  });

  it("validates policy partition requirements without throwing", () => {
    expect(
      validateStoragePolicy({
        id: "prefs",
        adapter: "local-storage",
        privacy: "user-private",
        partitionBy: ["tenant"],
      }).ok,
    ).toBe(false);
    expect(
      validateStoragePolicy({
        id: "prefs",
        adapter: "local-storage",
        privacy: "user-private",
        partitionBy: ["tenant", "user"],
      }).ok,
    ).toBe(true);
  });

  it("resolves partitions and builds deterministic storage keys", () => {
    const policy = {
      id: "prefs",
      adapter: "local-storage" as const,
      privacy: "user-private" as const,
      partitionBy: ["tenant", "user"] as const,
    };

    expect(resolveStoragePartition(policy, ctx)).toEqual({
      tenant: "tenant-a",
      user: "user-1",
    });
    expect(createStorageKey(policy, "cart item", ctx)).toBe(
      "mvp|prefs|local-storage|user-private|tenant:tenant-a|user:user-1|cart+item",
    );
  });

  it("rejects missing partition values", () => {
    const policy = {
      id: "prefs",
      adapter: "local-storage" as const,
      privacy: "user-private" as const,
      partitionBy: ["tenant", "user"] as const,
    };

    expect(() =>
      createStorageKey(policy, "cart", { ...ctx, user: undefined }),
    ).toThrow(StoragePolicyError);
  });

  it("creates cookie policies from explicit and storage-backed policy", () => {
    expect(createCookiePolicy("mvp_session").sameSite).toBe("lax");

    const cookie = createCookiePolicyForStorage(
      {
        id: "session",
        adapter: "cookie",
        privacy: "user-private",
        partitionBy: ["tenant", "user"],
        encrypted: true,
        ssr: true,
        ttl: 3600,
      },
      "mvp_session",
      { encrypted: false, httpOnly: false, signed: false },
    );

    expect(cookie).toMatchObject({
      name: "mvp_session",
      httpOnly: true,
      secure: true,
      signed: true,
      encrypted: true,
      maxAge: 3600,
    });
  });

  it("identifies only unpartitioned public policy as shared storage", () => {
    expect(
      canUseSharedStorage({
        id: "assets",
        adapter: "cache-api",
        privacy: "public",
        partitionBy: [],
      }),
    ).toBe(true);
    expect(
      canUseSharedStorage({
        id: "tenant-cache",
        adapter: "server-kv",
        privacy: "tenant",
        partitionBy: ["tenant"],
      }),
    ).toBe(false);
  });
});

function createMemoryWebStorageBackend(): WebStorageBackend & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    store,
    get length() {
      return store.size;
    },
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    key: (index) => [...store.keys()][index] ?? null,
  };
}

describe("storage adapters", () => {
  it("roundtrips values through the memory and server-kv adapters", async () => {
    for (const adapter of [
      createMemoryStorageAdapter(),
      createServerKvStorageAdapter(),
    ]) {
      await adapter.set("a", "1");
      await adapter.set("b", "2");
      expect(await adapter.get("a")).toBe("1");
      expect(await adapter.keys()).toEqual(["a", "b"]);
      await adapter.delete("a");
      expect(await adapter.get("a")).toBeUndefined();
    }
  });

  it("adapts injected web storage backends", async () => {
    const backend = createMemoryWebStorageBackend();
    const adapter = createWebStorageAdapter(backend);
    await adapter.set("theme", "dark");
    expect(backend.store.get("theme")).toBe("dark");
    expect(await adapter.get("theme")).toBe("dark");
    expect(await adapter.keys()).toEqual(["theme"]);
    await adapter.delete("theme");
    expect(await adapter.get("theme")).toBeUndefined();
  });

  it("parses cookie headers and serializes Set-Cookie mutations", async () => {
    expect(parseCookieHeader("a=1; b=hello%20world")).toEqual(
      new Map([
        ["a", "1"],
        ["b", "hello world"],
      ]),
    );

    const adapter = createCookieStorageAdapter({
      cookieHeader: "existing=1",
      attributes: { sameSite: "strict", domain: "example.com" },
    });
    expect(await adapter.get("existing")).toBe("1");

    await adapter.set("session", "abc", { ttlSeconds: 3600 });
    await adapter.delete("existing");

    const headers = adapter.toSetCookieHeaders();
    expect(headers[0]).toBe(
      "session=abc; Path=/; Domain=example.com; Max-Age=3600; HttpOnly; Secure; SameSite=Strict",
    );
    expect(headers[1]).toContain("existing=; Path=/");
    expect(headers[1]).toContain("Max-Age=0");
    expect(adapter.toCookieHeader()).toBe("session=abc");
  });

  it("signs cookie values and rejects tampered signatures", async () => {
    const adapter = createCookieStorageAdapter({ secret: "top-secret" });
    await adapter.set("session", "user-1");
    expect(await adapter.get("session")).toBe("user-1");

    const signed = adapter.toCookieHeader();
    expect(signed).toContain("user-1.");

    const tampered = createCookieStorageAdapter({
      cookieHeader: signed.replace("user-1", "user-2"),
      secret: "top-secret",
    });
    expect(await tampered.get("session")).toBeUndefined();

    const wrongSecret = createCookieStorageAdapter({
      cookieHeader: signed,
      secret: "other-secret",
    });
    expect(await wrongSecret.get("session")).toBeUndefined();

    const trusted = createCookieStorageAdapter({
      cookieHeader: signed,
      secret: "top-secret",
    });
    expect(await trusted.get("session")).toBe("user-1");
  });
});

describe("createStorage", () => {
  const userPolicy = {
    id: "prefs",
    adapter: "memory" as const,
    privacy: "user-private" as const,
    partitionBy: ["tenant", "user"] as const,
  };

  it("reads and writes JSON values under partitioned keys", async () => {
    const store = new Map<string, string>();
    const storage = createStorage(userPolicy, {
      ctx,
      adapter: createMemoryStorageAdapter(store),
    });

    await storage.setItem("cart", { items: [1, 2] });
    expect(await storage.getItem("cart")).toEqual({ items: [1, 2] });
    expect([...store.keys()][0]).toBe(
      "mvp|prefs|memory|user-private|tenant:tenant-a|user:user-1|cart",
    );
    expect(await storage.keys()).toEqual(["cart"]);

    await storage.removeItem("cart");
    expect(await storage.getItem("cart")).toBeUndefined();
  });

  it("isolates partitions sharing the same adapter", async () => {
    const adapter = createMemoryStorageAdapter();
    const tenantA = createStorage(userPolicy, { ctx, adapter });
    const tenantB = createStorage(userPolicy, {
      ctx: { ...ctx, tenant: "tenant-b" },
      adapter,
    });

    await tenantA.setItem("cart", "a-cart");
    await tenantB.setItem("cart", "b-cart");

    expect(await tenantA.getItem("cart")).toBe("a-cart");
    expect(await tenantB.getItem("cart")).toBe("b-cart");
    expect(await tenantA.keys()).toEqual(["cart"]);

    await tenantA.clear();
    expect(await tenantA.getItem("cart")).toBeUndefined();
    expect(await tenantB.getItem("cart")).toBe("b-cart");
  });

  it("expires entries after the policy ttl", async () => {
    let currentTime = 1_000_000;
    const storage = createStorage(
      { ...userPolicy, ttl: 60 },
      {
        ctx,
        adapter: createMemoryStorageAdapter(),
        now: () => currentTime,
      },
    );

    await storage.setItem("session", "alive");
    expect(await storage.getItem("session")).toBe("alive");

    currentTime += 61_000;
    expect(await storage.getItem("session")).toBeUndefined();
  });

  it("rejects user-private data on a public (unpartitioned) policy", () => {
    expect(() =>
      createStorage(
        {
          id: "prefs",
          adapter: "memory",
          privacy: "user-private",
          partitionBy: ["tenant"],
        },
        { ctx },
      ),
    ).toThrow(StoragePolicyError);
  });

  it("rejects contexts missing required partition values", () => {
    expect(() =>
      createStorage(userPolicy, { ctx: { ...ctx, user: undefined } }),
    ).toThrow(StoragePolicyError);
  });

  it("enforces policy through the cookie adapter end to end", async () => {
    const adapter = createCookieStorageAdapter({ secret: "top-secret" });
    const storage = createStorage(
      {
        id: "session",
        adapter: "cookie",
        privacy: "user-private",
        partitionBy: ["tenant", "user"],
        ttl: 3600,
      },
      { ctx, adapter },
    );

    await storage.setItem("token", "abc");
    expect(await storage.getItem("token")).toBe("abc");
    const setCookie = adapter.toSetCookieHeaders()[0];
    expect(setCookie).toContain("Max-Age=3600");
    expect(setCookie).toContain(encodeURIComponent("mvp|session|cookie"));
  });
});
