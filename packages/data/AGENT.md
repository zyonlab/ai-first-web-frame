# @mvp/data — AGENT.md

## What this package is for

`@mvp/data` is the domain-agnostic data-fetching client: it turns a declared
`DataSource` (id + `DataDependency` contract from `@mvp/contracts` + a `load`
function) into cached, deduplicated reads, fire-and-forget preloads, tag-based
invalidation, and freshness-driven subscriptions (polling or push-transport).
Every cache key is built from the dependency's `privacy` classification so
tenant/experiment/user partitioning is automatic and consistent, and
`realtime` data is refused during SSR (`validateRuntimeFreshness`) since it
can never be safely cached or awaited server-side. It has no knowledge of any
business domain — domain-specific source registries (e.g. a trade source
registry, `createTradeDataClient`) live outside this package (in
`domains/trade-data`) and are constructed by passing domain `DataSource[]`
into `createDataClient`. Use it inside a page/fragment's server-side data
resolution to back `dataDependencies` declared on fragment slots.

Note: the mock realtime data transport (deterministic PRNG, pure frame
generators, `createMockSubscriptionTransport`, `tradeFixtures`) is NOT part of
this package. It is demo/domain-specific mock infrastructure scoped to the
trade demo and lives in `domains/trade-data/src/transport` (re-exported from
`@mvp/trade-data`), not `@mvp/data` — this package only ships the generic
`SubscriptionTransport` interface and `createMemorySubscriptionTransport`
(push-on-demand, for contract tests).

## Entry points

- `createDataClient(options: DataClientOptions): { readData, preloadData, mutateData, subscribeData }`
  — `options: { ctx: RequestContext, sources: DataSource[], cache?: Map<string, DataCacheEntry> | CacheAdapter, trace?: RequestTrace, now?: () => number }`.
  Builds one client bound to a fixed source list and request context; call
  once per request (or once per subscription lifetime on the client) with the
  sources that request needs.
- `readData<TData, TParams>(sourceId: string, params?: TParams): Promise<DataReadResult<TData>>`
  — looks up `sourceId` in `sources`, validates the dependency isn't
  `client-local` (throws `DataDependencyError` otherwise via
  `validateRuntimeFreshness`), computes a partitioned cache key
  (`createDataKey`), returns the cached entry if unexpired, joins an
  in-flight load for the same key if one exists (`source: "pending"`), or
  calls `source.load({ ctx, params, signal? })` and caches the result when
  `dependency.cachePolicy.ttl > 0` and freshness isn't `"realtime"`. Returns
  `{ data, source: "loader" | "cache" | "pending", key, dependency }`. Throws
  `DataDependencyError` if `sourceId` isn't registered.
- `preloadData<TParams>(sourceId: string, params?: TParams): void` — fires
  `readData` without awaiting it (populates the cache/dedup map ahead of a
  later `readData` call); errors are not surfaced to the caller.
- `mutateData(tagOrKey: string): Promise<void>` — deletes the cache entry at
  `tagOrKey` as a literal key and invalidates it as a tag (both calls issued
  synchronously so the in-memory adapter reflects the change immediately);
  use after a mutation to bust affected reads.
- `subscribeData<TData, TParams>(sourceId: string, handler: (event: DataSubscriptionEvent<TData>) => void, options?: SubscribeDataOptions<TParams>): () => void`
  — only valid for `"realtime"` or `"near-realtime"` freshness sources
  (throws `DataDependencyError` otherwise). With no `options.transport`, polls
  `source.load` on an interval (`options.intervalMs`, default 1s for
  `realtime` / 5s for `near-realtime`) and delivers only when the
  stable-stringified payload changes; with `options.transport` (a
  `SubscriptionTransport`), connects the transport and delivers pushed
  messages instead of polling. Every delivered value is written through the
  cache first (evicting the dependency's `invalidationTags`, then re-caching
  if TTL-eligible) so concurrent `readData` calls observe it too. Returns an
  unsubscribe function that stops polling / closes the transport.
- `defineDataSource<TData, TParams>(source: DataSource<TData, TParams>): DataSource<TData, TParams>`
  — identity helper purely for call-site type inference; use when declaring a
  source object so its `load` input/output types are checked without an
  explicit generic.
- `createDataKey(dependency: DataDependency, ctx: RequestContext, params: unknown): string`
  — the partitioning function: always includes `{ id, freshness, params }`;
  adds `tenant: ctx.tenant` when `privacy !== "public"`, `experiment:
  ctx.experiment` when `privacy === "user-segment"`, and `user: ctx.user?.id`
  when `privacy === "user-private"`. Exported for building cache keys outside
  the client (e.g. warming a shared remote cache).
- `validateRuntimeFreshness(freshness: DataFreshness): void` — throws
  `DataDependencyError` if `freshness === "client-local"`; exported for reuse
  by callers that resolve data outside `readData`.
- `MemoryCacheAdapter` (class, implements `CacheAdapter`) — the default
  in-process cache, backed by a `Map<string, DataCacheEntry>`; constructing it
  with an existing `Map` preserves legacy `options.cache: Map` behavior
  (readable/writable by the caller). Implement the same `CacheAdapter`
  interface (`get`/`set`/`delete`/`invalidateTags`/`clear`, each sync-or-async)
  to back the client with Redis, a CDN cache API, or any shared store —
  `createDataClient`'s `cache` option accepts either a raw `Map` (wrapped
  automatically) or any `CacheAdapter`.
- `createMemorySubscriptionTransport(): MemorySubscriptionTransport` — an
  in-memory `SubscriptionTransport` (`connect`/`onMessage`/`close`, plus
  `publish(data)` and a `connected` getter) for tests and demos that need a
  push-style subscription without a real WebSocket/SSE backend. Messages
  published before `connect` or after `close` are dropped.

## Error taxonomy

- **`DataDependencyError`** — thrown by `readData`/`subscribeData` when
  `sourceId` is not in the client's `sources` list; by
  `validateRuntimeFreshness` (and therefore `readData`) when
  `dependency.freshness === "client-local"` (client-local data cannot be read
  during SSR); and by `subscribeData` when the source's freshness is neither
  `"realtime"` nor `"near-realtime"` (not subscribable). This is the only
  error type the package defines — it always signals a caller/config bug
  (wrong source id, wrong freshness tier for the call), never a transient
  network condition. `source.load` rejections propagate as-is (not wrapped)
  from `readData`; `subscribeData`'s polling path catches `load` rejections
  internally and only records them on the trace span, it does not call
  `handler` or throw.

## Example

```ts
import { createDataClient, defineDataSource, DataDependencyError } from "@mvp/data";
import { createRequestContext } from "@mvp/request-context";
import type { DataDependency } from "@mvp/contracts";

// `defineDataSource` parses this against `DataDependencySchema` at
// definition time — an incomplete or contradictory declaration throws.
const recommendationsDependency: DataDependency = {
  id: "recommendations",
  owner: "page",
  source: "api",
  freshness: "near-realtime",
  privacy: "user-segment",
  cachePolicy: { ttl: 30, tags: ["recommendations"], vary: ["tenant", "experiment", "props"] },
  invalidationTags: ["recommendations"],
  dependsOn: [],
};

const recommendationsSource = defineDataSource({
  id: "recommendations",
  dependency: recommendationsDependency,
  load: async ({ ctx, params }) => {
    return { items: [`hello-${ctx.tenant}`, `for-${params.userId ?? "anon"}`] };
  },
});

const ctx = createRequestContext();
const client = createDataClient({ ctx, sources: [recommendationsSource] });

const result = await client.readData("recommendations", { userId: "u1" });
console.log(result.source); // "loader" (first read) then "cache" on a later call

await client.mutateData("recommendations"); // bust the tag after a write

try {
  await client.readData("unknown-source");
} catch (error) {
  if (error instanceof DataDependencyError) console.error(error.message);
}

const unsubscribe = client.subscribeData("recommendations", (event) => {
  console.log("update", event.data);
});
unsubscribe();
```

## Accept

```
pnpm --filter @mvp/data test
```
Expected: Vitest exits 0. `packages/data/src/index.test.ts` covers cache hit /
loader / pending-dedup paths, tag invalidation, privacy-based key
partitioning, `client-local` rejection, and polling/transport subscription
delivery with change-detection.
