# Contracts first

`packages/contracts/src/index.ts` exports **35 Zod schemas** plus **6 pre-generated JSON
Schemas**. Every boundary in the system is one of them.

## What is covered

| Area | Schemas |
| --- | --- |
| Render wire format | `FragmentRenderRequestSchema`, `FragmentRenderRequestEnvelopeSchema`, `FragmentRenderResponseSchema` |
| Manifests | `FragmentManifestSchema`, `PageManifestSchema`, `ComponentManifestSchema`, `ComponentMetadataSchema` |
| Registry | `FragmentRegistrySchema`, `FragmentRegistryEntrySchema`, `ReleaseManifestSchema`, `RouteManifestSchema` |
| Context | `RequestContextSchema` |
| Islands | `IslandSnapshotSchema` |
| Interaction | `InteractionContractSchema` |
| Data | `DataDependencySchema`, `DataFreshnessSchema`, `DataPrivacySchema` |
| Caching / policy | `CachePolicySchema`, `RequestPolicySchema`, `StoragePolicySchema`, `CookiePolicySchema`, `ApiEndpointPolicySchema` |
| Assets | `AssetManifestSchema`, `AssetResourceSchema`, `ScriptAssetSchema`, `FontManifestSchema`, `I18nManifestSchema`, `ThemeManifestSchema` |
| Budgets | `PerformanceBudgetSchema` |
| Optimizer | `OptimizationFindingSchema`, `OptimizationEvidenceSchema`, `OptimizationFindingLocationSchema` |
| Workers | `WorkerManifestSchema` |
| Enums | `RenderStrategySchema`, `ReleaseChannelSchema` |

## The four enums worth memorising

```
RenderStrategy   static | ttl-cache | cached-ssr | dynamic-ssr
ReleaseChannel   stable | canary | preview
DataFreshness    static | build-time | isr | request-time | near-realtime | realtime | client-local
DataPrivacy      public | tenant | user-segment | user-private
```

`DataFreshness` × `DataPrivacy` is the grid that decides where a piece of data may be cached and
for how long. `user-private` data must never land in a shared cache entry — which is why
`cachePolicy.vary` exists and why `@mvp/storage` has `requiredPartitionKeysForPrivacy` and
`assertStoragePolicy`.

## For non-TypeScript consumers

```ts
import { toJsonSchema, FragmentManifestJsonSchema } from "@mvp/contracts";

toJsonSchema(SomeSchema, "SomeSchema");   // draft-07, optionally $ref-wrapped
```

Six schemas ship pre-generated so a tool that speaks only JSON Schema can validate the same
contracts a TypeScript consumer gets via `z.infer`: fragment manifest, page manifest, fragment
registry, render request, render response, request context.

## Parsing at the boundary

```ts
import { parseFragmentRenderRequest, parseFragmentRenderResponse } from "@mvp/contracts";

const parsed = parseFragmentRenderRequest(body);
// { ok: true, request, strict: boolean } | { ok: false, issues }
```

`parseFragmentRenderRequest` is **two-tier** by design: strict schema first, then a lenient
envelope where `ctx` is `.partial().optional()`, and `400` only when both fail. `strict` tells the
caller which tier matched — a signal that is currently produced and then ignored everywhere
([F14](../known-limitations.md#f14)).

## Budgets as contracts

```ts
import { loadDefaultBudget, mergeBudget, assertBudget, createBudgetReport } from "@mvp/contracts";
```

`assertBudget` throws on a violation; `createBudgetReport` returns a structured comparison. Note
that a schema field existing does not mean a gate reads it — see
[performance budgets](../guides/performance-budgets.md).

## Where schemas are not the answer

Two deliberate exceptions:

1. **Business vocabulary.** Do not widen `RequestContextSchema`; use `ctx.extensions`.
2. **Interaction payloads.** Those schemas live in the *domain* layer
   (`domains/trade-contracts/src/slices.ts`) next to the channel ids, not in `@mvp/contracts` —
   the framework provides `InteractionContractSchema` as the shape a contract must have, and the
   domain supplies the contracts.
