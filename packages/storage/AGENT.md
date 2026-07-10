# @mvp/storage — AGENT.md

## What this package is for

`@mvp/storage` is the domain-agnostic, policy-enforcing storage facade: given
a `StoragePolicy` (`@mvp/contracts` — id, adapter, privacy, ttl, partitionBy)
and a request-scoped partition context, it derives a fully-partitioned storage
key, enforces that the declared privacy tier has the required partition keys
(e.g. `user-private` must partition by `user`), and wraps a pluggable
`StorageAdapter` (memory, server-kv, cookie, local-storage, session-storage)
with JSON envelope (de)serialization and TTL-based expiry. It has no
knowledge of any business domain — domain-specific preference stores (e.g.
watchlist/recent-symbols prefs) live outside this package (in
`domains/trade-prefs`) and are built by calling `createStorage` with a
domain-owned policy. Use it wherever a fragment/page needs privacy-aware
persistence (cookies, KV, browser storage) instead of touching a storage
backend directly.

## Entry points

- `createStorage(policyInput: unknown, options: StorageInstanceOptions): StorageInstance`
  — `options: { ctx: StoragePartitionContext, adapter?: StorageAdapter, now?: () => number }`.
  Validates `policyInput` (`assertStoragePolicy`), fails fast if `ctx` cannot
  satisfy the policy's partition requirements (`resolveStoragePartition`), and
  picks a default adapter from `policy.adapter` when `options.adapter` isn't
  given (`memory`, `server-kv`, `cookie`, `local-storage`,
  `session-storage`; `indexed-db`/`cache-api` require an injected adapter or
  throw `StoragePolicyError`). Returns
  `{ policy, getItem, setItem, removeItem, keys, clear }`, all operating on
  "logical keys" scoped under the policy + partition.
- `storage.getItem<T>(logicalKey: string): Promise<T | undefined>` /
  `storage.setItem<T>(logicalKey: string, value: T): Promise<void>` /
  `storage.removeItem(logicalKey: string): Promise<void>` — JSON-envelope
  read/write/delete; `setItem` stamps `expiresAt` when `policy.ttl > 0`,
  `getItem` deletes and returns `undefined` on an expired or unparsable
  envelope.
- `storage.keys(): Promise<string[]>` / `storage.clear(): Promise<void>` —
  lists (or deletes) only the logical keys owned by this policy+partition,
  by stripping the derived key prefix from the adapter's full key list.
- `createStorageKey(policyInput: unknown, logicalKey: string, ctx: StoragePartitionContext): string`
  — the raw key-derivation function `createStorage` uses internally
  (`mvp|<policyId>|<adapter>|<privacy>|<partitionKey:value>...|<logicalKey>`,
  each segment URI-encoded); exported for adapters/tooling that need to
  compute a key without going through the full facade.
- `resolveStoragePartition(policyInput: unknown, ctx: StoragePartitionContext): Record<StoragePartitionKey, string>`
  — resolves each `policy.partitionBy` key to a concrete value from `ctx`
  (`tenant`/`locale`/`theme`/`device` read directly off `ctx`, `user` reads
  `ctx.user?.id`); throws `StoragePolicyError` if any required value is
  missing.
- `validateStoragePolicy(input: unknown): StoragePolicyValidationResult` —
  non-throwing check: `{ ok: true, policy, issues: [] }` or
  `{ ok: false, issues: string[] }`. Validates the shape against
  `StoragePolicySchema` and that `privacy` has its required partition keys
  present in `partitionBy` (`requiredPartitionKeysForPrivacy`). Use for
  linting a policy at scaffold/register time instead of catching an
  exception.
- `assertStoragePolicy(input: unknown): StoragePolicy` — throwing wrapper
  around `validateStoragePolicy`; used internally by every other function
  that accepts `policyInput: unknown`.
- `requiredPartitionKeysForPrivacy(privacy: DataPrivacy): StoragePartitionKey[]`
  — `"public"` → `[]`, `"tenant"` → `["tenant"]`, `"user-segment"` →
  `["tenant", "locale"]`, anything else (`"user-private"`) →
  `["tenant", "user"]`.
- `canUseSharedStorage(policyInput: unknown): boolean` — `true` only when
  `privacy === "public"` and `partitionBy.length === 0`; use to decide whether
  a value is safe to cache/share across requests without partitioning.
- `createCookiePolicy(name: string, overrides?): CookiePolicy` — builds a
  `CookiePolicySchema`-validated cookie policy (defaults: `httpOnly: true`,
  `secure: true`, `sameSite: "lax"`, `path: "/"`).
- `createCookiePolicyForStorage(policyInput: unknown, name: string, overrides?): CookiePolicy`
  — derives a `CookiePolicy` from a `StoragePolicy` (must have
  `adapter === "cookie"`, else throws `StoragePolicyError`): maps
  `policy.ttl` to `maxAge`, `policy.encrypted` to `encrypted`, forces `signed:
  true` for `"user-private"`/`"tenant"` privacy, and `httpOnly: true` when
  `policy.ssr` is set.
- `createMemoryStorageAdapter(store?: Map<string, string>): StorageAdapter` /
  `createServerKvStorageAdapter(store?: Map<string, string>): StorageAdapter`
  (an alias reference implementation for the `"server-kv"` policy adapter — a
  production Redis/edge-KV adapter implements the same `StorageAdapter`
  interface) / `createWebStorageAdapter(backend: WebStorageBackend): StorageAdapter`
  / `createLocalStorageAdapter(backend?: WebStorageBackend): StorageAdapter` /
  `createSessionStorageAdapter(backend?: WebStorageBackend): StorageAdapter`
  (the latter two default to the global `localStorage`/`sessionStorage`,
  throwing `StoragePolicyError` if unavailable — inject a `WebStorageBackend`
  in Node/tests) — the built-in `StorageAdapter` implementations
  (`get`/`set`/`delete`/`keys`, all async, `string`-valued).
- `createCookieStorageAdapter(options?: CookieStorageAdapterOptions): CookieStorageAdapter`
  — `options: { cookieHeader?: string, secret?: string, attributes?: CookieAttributes }`.
  Parses an incoming `Cookie` header into a jar, records `Set-Cookie` headers
  for every mutation, and — when `secret` is given — signs values with
  HMAC-SHA256 (`timingSafeEqual`-verified on read; a tampered/unsigned value
  reads as `undefined`, never throws). Adds `toSetCookieHeaders(): string[]`
  and `toCookieHeader(): string` beyond the base `StorageAdapter` interface.
- `parseCookieHeader(header: string): Map<string, string>` — the raw `Cookie`
  header parser used internally by `createCookieStorageAdapter`; exported for
  standalone use.

## Error taxonomy

- **`StoragePolicyError`** — the only error type this package defines.
  Thrown by `assertStoragePolicy` (and therefore every function that accepts
  `policyInput: unknown`) when the policy fails `StoragePolicySchema`
  validation or is missing a required partition key for its privacy tier; by
  `resolveStoragePartition` when `ctx` cannot supply a value for a declared
  partition key (e.g. no `ctx.user` for a `user`-partitioned policy); by
  `createCookiePolicyForStorage` when the policy's `adapter` isn't
  `"cookie"`; by `defaultAdapterForPolicy` (via `createStorage`) when the
  policy's adapter is `"indexed-db"`/`"cache-api"` and no adapter was
  injected; and by `createLocalStorageAdapter`/`createSessionStorageAdapter`
  when the corresponding global Web Storage object isn't available and no
  backend was injected. `getItem` never throws on a corrupt/expired envelope
  — it deletes the entry and resolves `undefined` instead.

## Example

```ts
import { createStorage, StoragePolicyError } from "@mvp/storage";
import type { StoragePolicy } from "@mvp/contracts";

const recentViewsPolicy: StoragePolicy = {
  id: "recent-views",
  adapter: "cookie",
  privacy: "user-private",
  ttl: 60 * 60 * 24 * 30,
  partitionBy: ["tenant", "user"],
};

const ctx = {
  tenant: "acme",
  locale: "en-US",
  theme: "system" as const,
  device: "desktop" as const,
  user: { id: "u-1", roles: [] },
};

const storage = createStorage(recentViewsPolicy, { ctx });

await storage.setItem("last-product", { sku: "sku-123" });
const value = await storage.getItem<{ sku: string }>("last-product");
console.log(value?.sku); // "sku-123"

try {
  createStorage(recentViewsPolicy, { ctx: { ...ctx, user: undefined } });
} catch (error) {
  if (error instanceof StoragePolicyError) console.error(error.message);
}

await storage.clear();
```

## Accept

```
pnpm --filter @mvp/storage test
```
Expected: Vitest exits 0. `packages/storage/src/index.test.ts` covers policy
validation/partition enforcement, key derivation and prefix-scoped
`keys`/`clear`, TTL expiry, every built-in adapter (memory, server-kv, web
storage, cookie including HMAC signing/tamper rejection), and the
`createCookiePolicyForStorage` derivation rules.
