# Manifests

Three manifest kinds, all Zod-validated.

## Fragment manifest — `fragments/<name>/src/manifest.ts`

`FragmentManifestSchema` fields:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | kebab-case; matches `data-fragment` in the markup |
| `version` | string | reported by `/health`, `/ready`, `/manifest` |
| `owner` | string | team |
| `renderMode` | `ssr` \| `edge-ssr` | |
| `renderStrategy` | `RenderStrategy` | default `dynamic-ssr` |
| `cachePolicy` | optional | `{ttl, tags, vary}` |
| `fallback` | string | HTML substituted on failure |
| `assets` | `{js: string[], css: string[]}` | |
| `proxy` | record | absolute URL **or** `/`-prefixed path; default `{}` |
| `subscriptions` | string[] | source-id templates the browser panel holds open; default `[]` |
| `budget` | `PerformanceBudget` | must have `scope: "fragment"` |

The live manifests also carry fields the schema does not model — `endpoint`, `dependsOn`,
`dataDependencies`, `consumes`, `produces`, `layoutHint`, `metadata`. `GET /manifest` returns the
object **verbatim**, so those fields do reach consumers, and the unit-graph loader validates with
`FragmentManifestSchema.passthrough()` so they survive validation rather than being stripped.

Two things to know about that validation:

- The **host does not do it.** `createFragmentServer` types its `manifest` as
  `FragmentManifestLike` — `{name, version, assets}` — and never parses it. Schema enforcement
  happens in `tools/release-tools/src/load-graph.ts`, which runs when you use the graph/affected
  tooling (`pnpm graph`, `pnpm affected:graph`), **not** in any of the 14 `pnpm verify` gates.
  All 14 real manifests do currently pass (`pnpm graph` loads 72 units).
- The passthrough fields are **convention, not contract**. `consumes.slices` /
  `produces.slices` in particular feed the unit graph's slice edges, and nothing reconciles them
  against the authoritative channel list — a declared channel no manifest mentions is invisible to
  the graph ([F15](../known-limitations.md#f15)).

`dataDependencies` vs `subscriptions` is the distinction to get right — see the
[glossary](../introduction/glossary.md).

## Page manifest — slots

`apps/<page>/src/manifest.slots.json` is a JSON **array** (not `{slots: […]}`). Each entry:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | slot id, unique per page |
| `fragment` | string | registry name |
| `channel` | `ReleaseChannel` | optional |
| `strategy` | `RenderStrategy` | optional |
| `timeoutMs` | int ≥ 0 | optional |
| `props` | record | optional |
| `staticHtml` | string | optional; used by `strategy: "static"` |
| `cachePolicy` | `{ttl, tags, vary}` | optional |
| `dependsOn` | string[] | other **slot** names; default `[]` |
| `dataDependencies` | string[] | page data-source ids; default `[]` |
| `required` | boolean | optional; `true` ⇒ failure makes the page `unhealthy` |

`reserved: true` appears in `page-product`'s `price-panel` slot. It is not in
`PageManifestSchema` — it is a convention that excludes the slot from codegen and keeps it
hand-rendered. That slot also names a fragment absent from the registry, which is why it never
renders; by design, but only discoverable by reading `CLAUDE.md`.

The wider page manifest (`PageManifestSchema`) adds `route`, `renderMode`
(`ssr`|`ssg`|`isr`|`hybrid`), `revalidateSeconds`, `seo: {title, description}`, `demonstrates`
(the capability index `docs/DEMOS.md` is generated from) and a page-scoped `budget`.

### Generated runtime form

Every successful `mount-slot` regenerates `apps/<page>/src/fragmentSlots.gen.ts` — a
`FragmentSlotDefinition[]` built straight from the JSON. Do not edit it.
`mount-slot --page <p> --check` verifies freshness; `pnpm verify:manifest-gen` does it for all
pages inside `pnpm verify`. Each page's `manifestSync.test.ts` additionally runs
`diffManifestAgainstRuntime` as a second, independent check.

## Registry — `registry/registry.data.json`

`FragmentRegistrySchema`:

```json
{ "fragments": { "<name>": {
    "stable":  { "version", "serviceUrl", "manifestUrl", "assetsUrl?" },
    "canary":  { … }, "preview": { … },
    "versions": { "<version>": { … } }
} } }
```

`serviceUrl` must parse as a URL. `versions` is promote/rollback history.
`registry/releases.json` is the append-only promotion log.

## Component manifest — `@mvp/ui`

`ComponentManifestSchema` = `{metadata, budget (scope "component"), assets}` where
`ComponentMetadataSchema` is `{category, serverSafe, propsSchema, description}`. `serverSafe` is
what the server/client boundary audit reads.

## JSON Schema for non-TypeScript consumers

`FragmentManifestJsonSchema`, `PageManifestJsonSchema`, `FragmentRegistryJsonSchema`,
`FragmentRenderRequestJsonSchema`, `FragmentRenderResponseJsonSchema`,
`RequestContextJsonSchema` — exported pre-generated (draft-07). `toJsonSchema(schema, name?)`
converts any other exported Zod schema on demand.
