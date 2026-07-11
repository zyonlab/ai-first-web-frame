# CONTRACTS.md — Schema index for `@mvp/contracts`

Index of every Zod schema exported from `@mvp/contracts`
(`packages/contracts/src/index.ts`), grouped by concern, with the real runtime
call site where each is enforced — so an agent can tell "validated at a
boundary" apart from "type-level contract only". Audience: AI agents
consuming or operating the framework. Lifecycle command envelopes are only
summarized here; [OPERATIONS.md](./OPERATIONS.md) is the authority for those.

> **Freshness caveat (hand-maintained, as of 2026-07-11).** This index is
> written by hand against `packages/contracts/src/index.ts` at that date. The
> intended end state is a *generated* index
> (`docs/ARCHITECTURE_REFACTOR_PLAN.md` §7 lists "CONTRACTS.md (schema index,
> generated)"). Until that lands, do not trust this file blindly after a
> schema change — check `packages/contracts/src/index.ts` first.

---

## 1. Schema index

"Enforced at" cites actual `.parse`/`.safeParse` call sites in production
code (not tests). Schemas with no production call site are marked
**type-level only** — they shape TS types and test fixtures but no runtime
boundary rejects bad data against them today.

### Fragment and component manifests

| Export | Validates | Enforced at |
| --- | --- | --- |
| `FragmentManifestSchema` | A fragment's `src/manifest.ts` (name, version, owner, renderMode `ssr\|edge-ssr`, renderStrategy, fallback, assets, fragment-scoped budget) | `tools/release-tools/src/load-graph.ts` (`loadFragmentManifest`/`loadFragments` run a `.passthrough()` `safeParse` on every manifest they load; a malformed manifest throws a schema-named error and kills graph construction for the affected engine, `mount-slot`, and `mcp-devx` instead of feeding the graph garbage). Convention fields outside the schema (`layoutHint`, `consumes`, `produces`, ...) pass through unvalidated. `create-component` scaffolds also emit `satisfies FragmentManifest` for compile-time checking. Each fragment's `/manifest` HTTP route still serves the object verbatim — the loader is the enforcement point. |
| `ComponentManifestSchema` / `ComponentMetadataSchema` | UI-component manifest (metadata + component-scoped budget + assets) | Type-level only. |
| `AssetResourceSchema` / `ScriptAssetSchema` / `FontManifestSchema` / `AssetManifestSchema` | CSS/JS/font asset declarations (href, scope, priority, script strategy incl. `island`) | Type-level only. |
| `ThemeManifestSchema` / `I18nManifestSchema` | Theme token version + supported themes; locale namespaces/fallback | Type-level only. |

### Page manifest and slots

| Export | Validates | Enforced at |
| --- | --- | --- |
| `PageManifestSchema` | A page manifest (name, route, renderMode `ssr\|ssg\|isr\|hybrid`, seo, `demonstrates`, page budget, `slots` array — see [COMPOSITION.md §1](./COMPOSITION.md)) | Whole-manifest: type-level only. The **slot element** is enforced hard: `packages/registry/src/slots.ts` (`applyMountSlot` `SlotSchema.parse`, `validatePageSlots`/`diffManifestAgainstRuntime` `safeParse`) validates every `mount-slot` write, and `packages/registry/src/codegen.ts` (`generateFragmentSlotsSource`, `safeParse` per slot) refuses to generate `fragmentSlots.gen.ts` from an invalid manifest. |
| `RenderStrategySchema` | Slot strategy enum `static\|ttl-cache\|cached-ssr\|dynamic-ssr` (the deprecated `isr` alias and its `normalizeRenderStrategy()` shim were retired after the deprecation window; a manifest declaring `isr` now fails slot validation) | Via the slot-element parsing above; compared and cache-keyed directly in `packages/runtime/src/index.ts` (`fetchFragmentSlot`, `createFragmentCacheKey`). |
| `CachePolicySchema` | `{ttl, tags, vary}` cache policy (slot- or data-level) | Via slot-element parsing above. |
| `ReleaseChannelSchema` | `stable\|canary\|preview` | `packages/registry/src/mutations.ts:55` (`safeParse` rejects bad `--channel` in `register-fragment`). |
| `RouteManifestSchema` | Route registry shape (id, path, page, serviceUrl, channel) | Whole-manifest: type-level only; `@mvp/routes` (`packages/routes/src/registry.ts`) ships a typed literal, and `resolveRoute` (`packages/runtime/src/index.ts`) consumes the type. The `serviceUrl` element schema (`z.string().url()`) is enforced hard against `PAGE_<NAME>_URL` env overrides in `buildRouteRegistry` — a garbage override throws at module load naming the env var and value. |

### Fragment registry and releases

| Export | Validates | Enforced at |
| --- | --- | --- |
| `FragmentRegistrySchema` | `registry/registry.data.json` (per-fragment channel entries + `versions` history; refinement: at least one channel or version) | `packages/registry/src/registry.ts:35` (`buildFragmentRegistry` parses on every load) and `packages/registry/src/mutations.ts` (re-parsed after every register/promote/rollback mutation before write). |
| `FragmentRegistryEntrySchema` | One channel entry: `version`, `serviceUrl`, `manifestUrl`, optional `assetsUrl` (C3 import-map spike) | Nested inside `FragmentRegistrySchema` at the same call sites. Its `serviceUrl` element schema (`z.string().url()`) is additionally enforced against `<NAME>_URL` env overrides in `buildFragmentRegistry` (`packages/registry/src/registry.ts`) — a garbage override throws at build/boot time naming the env var and value, instead of being spliced silently into every serviceUrl/manifestUrl. |
| `ReleaseManifestSchema` | One `registry/releases.json` entry (unit, name, version, channel, `rollbackTo`) | `packages/registry/src/mutations.ts` — built via `.parse` on promote/rollback, and `loadReleases` validates the whole file against `ReleasesFileSchema` (`{ releases: ReleaseManifestSchema.passthrough()[] }`) on load, so a malformed top level (e.g. `{"releases": {}}`) fails with a schema-named error instead of a downstream TypeError. |

### Render request / response (`POST /render`)

| Export | Validates | Enforced at |
| --- | --- | --- |
| `FragmentRenderRequestSchema` | Strict `/render` body: full `ctx` (`RequestContextSchema`) + `props` | Inside `parseFragmentRenderRequest` (strict pass). |
| `FragmentRenderRequestEnvelopeSchema` | Lenient envelope: every part optional but type-checked, so fragments own graceful degradation | Inside `parseFragmentRenderRequest` (lenient pass). |
| `parseFragmentRenderRequest()` | The edge parse: strict → lenient → structured `ZodIssue[]` failure naming the strict schema | Every fragment service's `POST /render` handler — all of `fragments/*/src/server.ts` (e.g. `fragments/order-form/src/server.ts:127`). |
| `FragmentRenderResponseSchema` | `/render` response (`html`, `assets`, `cache`, `metadata` incl. `metadata.fallback` for degraded renders) | Enforced at the consuming edge: `fetchFragment` (`packages/runtime/src/index.ts`) runs every `/render` body through `parseFragmentRenderResponse`; a schema-invalid response degrades that slot to its fallback with the violation `console.warn`ed and recorded as the trace span's `error` attribute — never a silent cast. |
| `parseFragmentRenderResponse()` | The consuming-edge parse: strict validation → structured `ZodIssue[]` failure naming the schema (no lenient tier — a fragment that can't produce a valid response is treated as failed) | `fetchFragment` in `packages/runtime/src/index.ts`. |

### Request context

| Export | Validates | Enforced at |
| --- | --- | --- |
| `RequestContextSchema` | Per-request context (traceId, requestId, locale, tenant, user/session, featureFlags, theme, device, timestamp) | `packages/request-context/src/index.ts:56` — `createRequestContext` parses the context it builds from headers on every request; also embedded in the strict `/render` body schema above. |

### Data and platform policies

| Export | Validates | Enforced at |
| --- | --- | --- |
| `DataDependencySchema` (+ `DataFreshnessSchema`, `DataPrivacySchema`) | A data-source declaration (owner, source, freshness, privacy; refinements: user-private data can't be static, realtime can't TTL-cache, subscriptions must be realtime) | `packages/data/src/index.ts` — `defineDataSource` runs `safeParse` on every dependency at definition time, so the `superRefine` invariants actually execute; a contradictory declaration throws a `DataDependencyError` naming the schema at module load. |
| `ApiEndpointPolicySchema` / `RequestPolicySchema` | Allowed endpoints/methods/timeouts/retries for `@mvp/request` | Type-level only. |
| `StoragePolicySchema` | Storage adapter policy (refinement: user-private must partition by user) | `packages/storage/src/index.ts:50` (`safeParse` on policy registration). |
| `CookiePolicySchema` | Cookie attributes | `packages/storage/src/index.ts:124` (`.parse` when building a cookie policy). |
| `WorkerManifestSchema` | Worker declaration (kind, scope, privacy) | `packages/workers/src/index.ts:43` (`safeParse` on registration). |

### Interaction contracts (cross-island bus)

| Export | Validates | Enforced at |
| --- | --- | --- |
| `InteractionContractSchema` | A bus channel contract (channel, publisher, subscribers, payloadSchema) | `packages/interaction/src/index.ts:205` — `createInteractionBus` parses every contract at construction; payloads are checked per publish against `payloadSchema` (Zod-like schemas via `safeParse`, `packages/interaction/src/index.ts:100`). See [INTERACTION.md](./INTERACTION.md). |

### Island snapshots (C2 handshake)

| Export | Validates | Enforced at |
| --- | --- | --- |
| `IslandSnapshotSchema` | The inline `<script type="application/json" data-island-props>` snapshot (`props` required-with-default; `slice`/`fragment`/`version`/`contractHash` optional) | `packages/islands/src/index.ts:205` — `mountIsland` validates before hydrating; an unparseable/malformed snapshot skips hydration via the same degradation path as a C2 version mismatch (`reason: "invalid-snapshot"`), never a silent empty-props hydrate. See [COMPOSITION.md §6](./COMPOSITION.md). |

### Performance budgets and optimizer findings

| Export | Validates | Enforced at |
| --- | --- | --- |
| `PerformanceBudgetSchema` (+ `loadDefaultBudget`, `mergeBudget`, `assertBudget`, `createBudgetReport`) | Component/fragment/page/shell budgets (hard gates in `pnpm verify`) | `packages/contracts/src/index.ts:646` (`mergeBudget` parses the merged result); budget refinements are embedded in the manifest schemas above. |
| `OptimizationFindingSchema` (+ `OptimizationFindingLocationSchema`, `OptimizationEvidenceSchema`) | One optimizer finding (severity, category, evidence, recommendation) | `packages/optimizer/src/index.ts` — every emitted finding is built via `.parse` (lines 224, 303, 412, 444, 477). |

## 2. JSON Schema exports (for non-TS agents)

`@mvp/contracts` exports `toJsonSchema(schema, name?)`
(`packages/contracts/src/index.ts`), which converts any exported Zod schema to
a plain JSON Schema object via `zod-to-json-schema` (draft-07 by default);
passing `name` wraps the result in the `$ref`/`definitions` convention.
Ready-made constants are exported for the boundary schemas:

| Export | Source schema |
| --- | --- |
| `FragmentManifestJsonSchema` | `FragmentManifestSchema` |
| `PageManifestJsonSchema` | `PageManifestSchema` |
| `FragmentRegistryJsonSchema` | `FragmentRegistrySchema` |
| `FragmentRenderRequestJsonSchema` | `FragmentRenderRequestSchema` |
| `FragmentRenderResponseJsonSchema` | `FragmentRenderResponseSchema` |
| `RequestContextJsonSchema` | `RequestContextSchema` |

Any other schema in §1 can be converted on demand with `toJsonSchema`.

## 3. CLI envelope and conflict/retry contract

Every lifecycle script (`scripts/register-fragment.mts`,
`scripts/mount-slot.mts`, `scripts/promote-fragment.mts`,
`scripts/rollback-fragment.mts`, and `tools/create-component`) prints exactly
one JSON object to stdout using the uniform envelope:

```ts
{
  status: string;        // e.g. "registered" | "mounted" | "promoted" | "failed" | "conflict" | ...
  action?: string;       // mutation kind, e.g. "added" | "updated" | "unchanged" | "removed"
  files: string[];       // workspace-relative paths written; [] when nothing was written
  warnings?: string[];   // non-fatal advisories (mount-slot)
  error?: string;        // present only on failure
  retry?: boolean;       // present only on "conflict": rerun the same command
}
```

Writes are atomic (temp file + rename) behind a `<file>.lock` advisory lock
with an optimistic content-hash check; if another process changed the file
between load and write, the script prints `{"status": "conflict", "retry":
true}` and exits 1 **without writing** — rerun the identical command. Failure
never leaves partial writes. Per-script status values, accept criteria, and
exit codes are specified step by step in [OPERATIONS.md](./OPERATIONS.md);
do not duplicate them from here.

## Related docs

- [OPERATIONS.md](./OPERATIONS.md) — the seven-step lifecycle these schemas gate.
- [COMPOSITION.md](./COMPOSITION.md) — how slot/strategy/streaming contracts behave at runtime.
- [INTERACTION.md](./INTERACTION.md) — bus/store contracts in depth.
- [DELIVERY.md](./DELIVERY.md) — affected-set model and deploy gates.
