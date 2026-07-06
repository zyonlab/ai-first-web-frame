import { describe, expect, it } from "vitest";
import {
  canUseSharedStorage,
  createCookiePolicy,
  createCookiePolicyForStorage,
  createStorageKey,
  requiredPartitionKeysForPrivacy,
  resolveStoragePartition,
  StoragePolicyError,
  validateStoragePolicy,
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
