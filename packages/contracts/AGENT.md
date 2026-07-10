# @mvp/contracts — AGENT.md

## What this package is for

`@mvp/contracts` is the single source of truth for every schema that crosses a
boundary in the framework: fragment manifests, page manifests, route manifests,
the fragment registry, `/render` request/response bodies, request context,
performance budgets, and optimizer findings. Every schema is a Zod object with
an inferred TypeScript type of the same name minus `Schema`. Producers call
`.parse()` (throws `ZodError` on invalid input) or `.safeParse()` (returns a
result object) against these schemas instead of hand-writing `as const`
literals or casting. This package has zero framework dependencies — everything
else in the framework layer depends on it, never the other way around.

## Entry points

- `FragmentManifestSchema: z.ZodObject<...>` / `type FragmentManifest` — shape
  of a fragment's manifest (`name`, `version`, `owner`, `renderMode`,
  `renderStrategy`, `cachePolicy?`, `fallback`, `assets`, `budget`). Parse this
  when loading or generating a fragment manifest.
- `PageManifestSchema` / `type PageManifest` — shape of a page manifest,
  including its `slots` array (`name`, `fragment`, `channel?`, `strategy?`,
  `timeoutMs?`, `props?`, `staticHtml?`, `cachePolicy?`, `dependsOn?`,
  `required?`). Parse this when loading `manifest.slots.json`-derived data.
- `RequestContextSchema` / `type RequestContext` — the per-request context
  object (`traceId`, `requestId`, `locale`, `tenant`, `user?`, `session?`,
  `featureFlags`, `experiment`, `theme`, `device`, `userAgent`, `ip?`,
  `timestamp`). Used by `@mvp/request-context` and every fragment's `/render`.
- `FragmentRenderRequestSchema` / `FragmentRenderResponseSchema` — the exact
  wire contract for `POST /render` on a fragment service
  (`{ ctx, props }` in, `{ html, assets, cache, metadata }` out).
- `FragmentRegistrySchema` / `type FragmentRegistry` — shape of
  `platform/fragment-registry/src/registry.data.json`: a map of fragment name
  to `{ stable?, canary?, preview?, versions? }`, each entry
  `{ version, serviceUrl, manifestUrl }`.
- `loadDefaultBudget(scope, name?): PerformanceBudget` /
  `mergeBudget(default, custom): PerformanceBudget` /
  `assertBudget(actual, budget): { ok, violations }` — the performance budget
  helpers; `assertBudget` is what `pnpm verify`'s bundle/css audits call.

## Error taxonomy

- **`ZodError`** — thrown by any `<Schema>.parse(...)` call when the input does
  not match the schema. Inspect `error.issues` (array of `{ path, message,
  code }`) to find the offending field. This is the only error type this
  package throws directly; every schema listed above can raise it.
- **`.safeParse(...)` failure** — not a thrown error but a
  `{ success: false, error: ZodError }` result; prefer this at boundaries where
  you want to convert a bad input into a structured response instead of an
  exception (e.g. fragment `/render` handlers).
- Schema-level refinements add domain-specific issues beyond basic type
  checking, e.g. `DataDependencySchema` rejects `privacy: "user-private"` with
  `freshness: "static"`, and `StoragePolicySchema` rejects `user-private`
  storage that does not `partitionBy: ["user", ...]`. These surface as normal
  `ZodError` issues with a `custom` code and a descriptive `message`.

## Example

```ts
import {
  FragmentManifestSchema,
  loadDefaultBudget,
  type FragmentManifest,
} from "@mvp/contracts";
import { z } from "zod";

const candidate = {
  name: "price-panel",
  version: "0.1.0",
  owner: "trade-team",
  renderMode: "ssr",
  renderStrategy: "dynamic-ssr",
  fallback: "<section>price-panel unavailable</section>",
  assets: { js: [], css: [] },
  budget: loadDefaultBudget("fragment", "price-panel"),
};

const result = FragmentManifestSchema.safeParse(candidate);
if (!result.success) {
  console.error(result.error.issues);
  throw new Error("invalid fragment manifest");
}
const manifest: FragmentManifest = result.data;
console.log(manifest.name, manifest.budget.jsBytes);
```

## Accept

```
pnpm --filter @mvp/contracts test
```
Expected: Vitest exits 0; `packages/contracts/src/index.test.ts` passes (schema
parse/reject cases for the manifests and budgets above). For a standalone
sanity check without the test runner (this package ships ESM only, so build
first, then use a dynamic `import()`):

```
pnpm --filter @mvp/contracts build
node -e "
import('./packages/contracts/dist/index.js').then(({ FragmentManifestSchema }) => {
  const r = FragmentManifestSchema.safeParse({ name: 'x' });
  console.log(JSON.stringify({ ok: r.success }));
});
"
```
Expected JSON: `{"ok":false}` (a bare `{ name: 'x' }` is missing required
fields, so `safeParse` reports failure).
