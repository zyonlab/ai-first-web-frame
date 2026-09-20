# Page composition

A page declares slots; the framework fills them. The page never contains per-fragment wiring.

## The manifest is the source of truth

`apps/<page>/src/manifest.slots.json` is a JSON **array** of slot objects:

```json
[
  {
    "name": "promotion",
    "fragment": "promotion-banner",
    "channel": "stable",
    "strategy": "cached-ssr",
    "timeoutMs": 200,
    "props": { "scene": "home", "campaignId": "summer" },
    "cachePolicy": { "ttl": 60, "tags": ["promotion", "home"], "vary": ["tenant", "locale"] },
    "required": false
  }
]
```

Edit it with `mount-slot`, not by hand — a successful mount regenerates
`src/fragmentSlots.gen.ts` from it, and `pnpm verify:manifest-gen` fails the build if the two
drift.

`src/fragmentSlots.ts` stays hand-written but thin: it wraps the generated array and adds only
per-request glue that cannot be expressed statically — a `timeoutMs` override, a `resolveData`
function, or (on `page-trade`) merging the per-request `props.symbol`.

## Rendering slots

`page.tsx` renders through `<FragmentSlot>` / `<FragmentSlotStream>` from `@mvp/runtime/react`:

```tsx
import { FragmentSlot, PageHealthMeta } from "@mvp/runtime/react";

const execution = await executeFragmentSlots({ slots, registry, ctx, dataDependencies });

return (
  <main>
    <FragmentSlot result={execution.slots.promotion} />
    <PageHealthMeta health={execution.health} failed={failedRequiredSlotNames(execution)} />
  </main>
);
```

Two entry points, one choice:

- `executeFragmentSlots` — one barrier: resolves everything, then you render. Simple.
- `streamFragmentSlots` — returns immediately with one promise per slot plus an aggregate, so
  the shell and each `<Suspense>` boundary can flush as its own layer settles.
  `executeFragmentSlots` is literally `streamFragmentSlots(options).result`.

## Strategies

| Strategy | Behaviour |
| --- | --- |
| `static` | no service call; `staticHtml` from the manifest is emitted |
| `ttl-cache` | served from the bounded in-process cache while fresh |
| `cached-ssr` | rendered, then cached per `cachePolicy` |
| `dynamic-ssr` | rendered per request |

`cachePolicy.vary` partitions the cache key by context dimensions (`tenant`, `locale`, `props`).
The cache is bounded (`DEFAULT_FRAGMENT_CACHE_MAX_ENTRIES`) with `pruneFragmentCache` and
tag-based invalidation via `invalidateFragmentCacheByTag`.

## Every slot result is inspectable

```ts
type FragmentSlotResult = {
  slot: FragmentSlotDefinition;
  strategy: RenderStrategy;
  source: "static" | "cache" | "network" | "fallback";
  status: "ok" | "fallback" | "skipped-dependency";
  // …
};
```

`source` answers "where did these bytes come from"; `status` answers "did it work". A slot can
be `source: "fallback"` with `status: "fallback"` (its own service failed) or
`status: "skipped-dependency"` (something it depended on failed first).

## What the demo actually composes

19 slots across 5 pages. `page-trade` has 9 (the realtime terminal), `page-product` 4,
`page-home` 3, `page-portfolio` 2, `page-markets` 1. `page-referrals` and `page-vaults` exist as
apps but compose no fragments.
