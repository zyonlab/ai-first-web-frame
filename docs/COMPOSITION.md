# COMPOSITION.md — Slots, strategies, and streaming semantics

Machine-actionable reference for how a composed page is assembled from
fragments: the slot model in `apps/<page>/src/manifest.slots.json`, the render
strategies, the codegen pipeline that makes the manifest the single source of
truth, the DAG execution/streaming semantics in `@mvp/runtime`, and the
two-tier independence model for shipping fragments. The audience is AI agents
operating this framework; for the lifecycle commands that *mutate* slots
(`mount-slot`, `register-fragment`, promote/rollback envelopes) see
[OPERATIONS.md](./OPERATIONS.md) — this doc covers what the composed system
*does* with those declarations at build and request time.

---

## 1. The slot model: `manifest.slots.json` is the single source of truth

Each composed page (`page-home`, `page-product`, `page-markets`,
`page-portfolio`, `page-trade`) declares its fragment slots in
`apps/<page>/src/manifest.slots.json`. That file is hand-edit-forbidden — it
is only mutated through `scripts/mount-slot.mts` (see
[OPERATIONS.md §4](./OPERATIONS.md)) and every entry is validated against the
slot element of `PageManifestSchema.slots`
(`packages/contracts/src/index.ts`) on write (`applyMountSlot` in
`packages/registry/src/slots.ts` runs `SlotSchema.parse`).

Slot fields (from `PageManifestSchema.slots`, `packages/contracts/src/index.ts`):

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | yes | Slot identifier, unique per page; the key used by `<FragmentSlot name>` and the `slot:<name>` DAG node. |
| `fragment` | `string` | yes | Fragment name resolved against the registry (`registry/registry.data.json`). |
| `channel` | `"stable" \| "canary" \| "preview"` | no (runtime default `stable`) | Which registry channel to resolve; `mount-slot` writes `stable` when the flag is omitted. |
| `strategy` | see §2 | no (runtime default `dynamic-ssr`) | Render strategy; `DEFAULT_RENDER_STRATEGY = "dynamic-ssr"` in `packages/runtime/src/index.ts`. |
| `timeoutMs` | `int >= 0` | no | Per-slot fetch timeout; overrides the execution-wide `timeoutMs` (default 200ms). |
| `props` | `Record<string, unknown>` | no | Static props sent as the `/render` body's `props`. Per-request props (e.g. `page-trade`'s `symbol`) cannot live here — see §3. |
| `staticHtml` | `string` | no | Inline HTML for `strategy: "static"` slots; no network call is made. |
| `cachePolicy` | `CachePolicySchema` (`ttl`, `tags`, `vary`) | no | Cache TTL/tags/vary dimensions for cacheable strategies (§2). |
| `dependsOn` | `string[]` | no | Names of slots that must finish first (DAG edge `slot:<dep> -> slot:<name>`). Set via `mount-slot --depends-on <json-array>` (`scripts/mount-slot.mts`). |
| `dataDependencies` | `string[]` | no | Ids in the page's data-source registry that must resolve first (DAG edge `data:<id> -> slot:<name>`); resolved by the page's `resolveData` callback. |
| `required` | `boolean` | no | A failing required slot makes page `health: "unhealthy"` and its failure propagates to dependents (§4). |
| `reserved` | `boolean` | no (convention) | **Not in the base schema** — a passthrough convention (`SlotPassthroughSchema` in `packages/registry/src/slots.ts` and `packages/registry/src/codegen.ts`): the slot is declared in the manifest but hand-rendered outside the runtime scheduler, and excluded from codegen (§3). |

## 2. Render strategies

The strategy enum is `RenderStrategySchema` (`packages/contracts/src/index.ts`):
`"static" | "ttl-cache" | "cached-ssr" | "dynamic-ssr"`.

| Strategy | Behavior (`fetchFragmentSlot`, `packages/runtime/src/index.ts`) |
| --- | --- |
| `static` | No network. Renders `slot.staticHtml` (fallback HTML with reason `"missing static html"` if absent). Cache TTL defaults to 31,536,000s. |
| `ttl-cache` | Fetch `POST <serviceUrl>/render`, cache the response in the in-memory `FragmentCache` under a key from `createFragmentCacheKey` for `slot.cachePolicy.ttl ?? response.cache.ttl` seconds. Fallback responses are never cached. |
| `cached-ssr` | Same caching path as `ttl-cache`; by convention used for short-TTL near-realtime slots (e.g. `page-markets`, 5s TTL). |
| `dynamic-ssr` | Always fetch `POST /render` per request. The default when a slot declares no strategy. |

**The retired `isr` alias**: slot-strategy `isr` collided with Next.js ISR
semantics (a *page-level* concept), violating goal A4 ("no two framework
concepts share a name with different semantics",
`docs/ARCHITECTURE_REFACTOR_PLAN.md` §0/§4.4.1). The rename to `ttl-cache`
shipped as a CLI codemod over live manifests (PR #9), and after the
deprecation window the alias was removed outright: `"isr"` is no longer a
member of `RenderStrategySchema` (a manifest declaring it fails slot
validation with a `ZodIssue` naming the enum), and the
`normalizeRenderStrategy()` shim is gone. Two *different* concepts spelled
`"isr"` are untouched and unrelated — they mean actual Next.js ISR:
`PageManifestSchema.renderMode: "isr"` and `DataFreshnessSchema`'s `"isr"`
member.

Cache keys vary on `slot.cachePolicy.vary` (default
`["tenant", "locale", "experiment", "props"]`; `"device"` opt-in) plus
fragment name, resolved version, and strategy
(`createFragmentCacheKey`, `packages/runtime/src/index.ts`).

## 3. Codegen pipeline: manifest → generated slots → thin wrapper → JSX

Rolled out to all five pages (plan §3, P2). The chain, end to end:

1. **`mount-slot` writes the manifest** and, after every successful
   mount/unmount, regenerates `apps/<page>/src/fragmentSlots.gen.ts` via
   `generateFragmentSlotsSource` (`packages/registry/src/codegen.ts`) — a
   pure transform from `manifest.slots.json` to a
   `FragmentSlotDefinition[]`, run through `biome format` before writing so
   write and `--check` compare identical canonical text.
2. **Reserved slots are excluded by design**: codegen filters
   `reserved: true` slots (`codegen.ts`, `.filter((slot) => slot.reserved !== true)`).
   The one live example is `page-product`'s `price-panel`
   (`apps/page-product/src/manifest.slots.json`), which is hand-rendered in
   `apps/page-product/app/product/[id]/page.tsx` outside the scheduler.
3. **`fragmentSlots.ts` stays a thin hand-written wrapper** importing the
   generated array. Only per-request glue that a static manifest cannot
   express lives there: the `timeoutMs` override, the `resolveData`
   data-client glue, and — for `page-trade`, whose 9 slots all need a
   per-request `props.symbol` — a
   `generatedSlots.map(slot => ({ ...slot, timeoutMs, props }))` merge.
4. **`page.tsx` renders by slot name** with `<FragmentSlot>` from
   `@mvp/runtime/react` (`packages/runtime/src/react.tsx`) — either
   `{ name, execution, fallback }` (lookup in an
   `executeFragmentSlots` result) or `{ response, fallback }` (an
   already-resolved response). HTML present → `dangerouslySetInnerHTML`;
   otherwise the fallback. Streaming pages use `<FragmentSlotStream>` (§5).

**Freshness gate**: `mount-slot --page <page> --check` recomputes the gen file
and diffs it against disk without writing (`{status: "fresh" | "stale"}`,
exit 1 on stale — see [OPERATIONS.md §4](./OPERATIONS.md)).
`pnpm verify:manifest-gen` (`scripts/verify-manifest-gen.mts`) runs `--check`
for every page with a `fragmentSlots.gen.ts` and is one of `pnpm verify`'s
gates, so manifest↔runtime drift is structurally impossible, not merely
detected. Each page's `tests/manifestSync.test.ts`
(`diffManifestAgainstRuntime`, `packages/registry/src/slots.ts`) remains as a
belt-and-suspenders check.

## 4. Execution semantics: `executeFragmentSlots` and the DAG

Both execution APIs live in `packages/runtime/src/index.ts` and share one
scheduling implementation: `executeFragmentSlots(options)` is literally
`streamFragmentSlots(options).result` — behaviorally identical by construction.

- **DAG ordering**: `createSlotDataExecutionPlan` builds nodes `slot:<name>`
  and `data:<id>` from `dependsOn`/`dataDependencies` and topologically
  levels them; each level runs under `Promise.all`. Duplicate slot/data
  names, edges to missing nodes, and dependency cycles all `throw` at
  plan-build time.
- **Per-slot timeouts**: `slot.timeoutMs ?? options.timeoutMs` (default
  200ms) races the `/render` fetch via `withTimeout`; data resolutions use
  `dataTimeoutMs ?? timeoutMs`.
- **Fallback isolation**: a failing, slow, or unregistered slot degrades to
  `createFallbackResponse` (`<section data-fragment="..."
  data-fallback="true">`, cache TTL 5) — it never rejects and never breaks
  the page. Fragments mark degraded output via
  `metadata.fallback: true` (`isFallbackResponse`; the HTML-marker sniff is
  deprecated).
- **Failure propagation**: a failed *data* node, or a failed **required**
  slot, blocks its downstream dependents, which settle as
  `status: "skipped-dependency"` fallbacks. A failed *non-required* slot
  degrades only itself.
- **Health**: `FragmentSlotsExecution.health` is `"unhealthy"` if any
  required slot failed, `"degraded"` if anything else failed, else `"ok"`.
  `onRequiredFailure: "fallback" | "throw"` (default `"fallback"`) decides
  whether required-slot failure throws from the aggregate.
- **Scheduler hints**: the plan also emits `SchedulerHint`s
  (`long-serial-chain`, `unnecessary-barrier`, `duplicate-data-resolution`)
  surfaced in each page's diagnostics section.

## 5. Streaming: `streamFragmentSlots` + `<FragmentSlotStream>`

`streamFragmentSlots` returns **immediately** with a
`FragmentSlotStreamHandle`: one `Promise<FragmentRenderResponse>` per declared
slot (each resolving the moment its own DAG level finishes; always resolves,
never rejects — failures resolve to the fallback response) plus one aggregate
`result: Promise<FragmentSlotsExecution>` for sections that need the whole
picture (health, hints, trace log). `<FragmentSlotStream slotPromise
fallback>` (`packages/runtime/src/react.tsx`) is the async-Server-Component
counterpart of `<FragmentSlot>`: wrap it in `<Suspense>` and that slot's HTML
flushes as soon as its own promise settles, independent of siblings.

**Who streams today**: `page-home`, `page-product`, `page-markets`,
`page-portfolio` (each exports a `stream*FragmentSlots` entry in its
`fragmentSlots.ts`; rollout PR #14). **`page-trade` deliberately stays on the
barrier API** (`executeFragmentSlots`): streaming was prototyped there and
reverted because plain `react-dom/server` cannot execute async Server
Components outside Next's real RSC runtime (it throws "Objects are not valid
as a React child (found: [object Promise])"), and `page-trade`'s
`trade-nav.test.tsx` renders the page through `react-dom/server` — rationale
recorded in [DEMOS.md](./DEMOS.md) and
`docs/ARCHITECTURE_REFACTOR_PLAN.md` §4.4 status.

## 6. Two-tier independence: what ships alone, what is build-frozen

Plan §7 names this table explicitly; the tiers come from goals C1–C3
(`docs/ARCHITECTURE_REFACTOR_PLAN.md` §0).

| | Tier 1 — SSR/patch-only fragment | Tier 2 — React-island fragment |
| --- | --- | --- |
| Examples | `promotion-banner`, `markets-table`, `order-book`, `trades-feed` | `market-header`, `chart-panel`, `account-bar`, `order-form` |
| What ships independently | Everything. SSR HTML is fetched per request via `POST /render`; deploy + `promote-fragment` → live with **0 page rebuilds** (goal C1). | Only the SSR HTML. It goes live exactly like tier 1. |
| What is build-frozen | Nothing. | The island's client JS: the React component is statically imported into the page bundle at build time (`apps/page-trade/src/hydrate.tsx`, `registerTradeIslands`), so island *behavior* changes need a page rebuild. |
| Version skew | Not possible — the HTML is always the fragment service's current output; failure degrades to the slot fallback (§4). | Detected, not silent (goal C2): the fragment stamps `{fragment, version}` (schema also carries `contractHash`) into its inline `<script type="application/json" data-island-props>` snapshot; `registerIsland(name, component, { expectedVersion, expectedContractHash })` declares the page bundle's expectation; on mismatch `mountIsland`/`hydrateIslands` (`packages/islands/src/index.ts`) **skip hydration entirely** — no `createRoot` call — keep the SSR HTML as the final static state, `console.warn`, and invoke the `configureIslandRuntime({ onSnapshotMismatch })` hook. A snapshot with no `version` (a non-participating fragment) hydrates normally. |
| Path to full independence | Already there. | The C3 import-map spike (merged as PR #1): registry entries gain an optional `assetsUrl` (`FragmentRegistryEntrySchema`, `packages/contracts/src/index.ts`); the page emits an import map + runtime `import()` of the fragment-served island module. Validated end-to-end on **`order-form` only**; the full rollout was decided **no-go for this cycle** (2026-07-11, no island-only-ship demand yet — decision record and reopen trigger in `docs/ARCHITECTURE_REFACTOR_PLAN.md` §4.3.3). |

## 7. Fragment backend proxy (`FragmentManifest.proxy`)

A fragment can reach its backend during SSR through `@mvp/request`. Its
**hydrated island could not**: the only options were a one-shot value baked into
the island snapshot, or a hard-coded cross-origin URL — which leaks the internal
service address to the browser and needs CORS (exactly what the C3 spike hit with
`Access-Control-Allow-Origin` on the island bundle).

`proxy` closes that gap, modelled on [`@podium/proxy`](https://github.com/podium-lib/proxy):

```ts
// fragments/order-form/src/manifest.ts
proxy: { quotes: "https://quotes.internal/v1" }
```

The shell gateway mounts every declared target at

```
/_fragment/<fragment>/<target>/<rest...>
```

so the island calls `/_fragment/order-form/quotes/BTC?depth=10` — same origin, no
CORS, and the fragment's real `serviceUrl` never reaches the browser. The gateway
forwards the request with the same `RequestContext` headers a `/render` call
carries, under `SHELL_FRAGMENT_PROXY_TIMEOUT_MS` (default 6000ms, matching
Podium's default), and answers `no-store` because proxied data is per-request by
nature.

| Behavior | Where |
| --- | --- |
| Path parsing, URL joining, escape check (all pure) | `packages/runtime/src/fragmentProxy.ts` |
| Route mounting, manifest fetch + version-keyed cache, forwarding | `apps/shell-gateway/src/server.ts` |
| Schema | `FragmentManifestSchema.proxy` — `z.record(z.string().url()).default({})` |

Two invariants worth knowing:

- **The declared base is the boundary.** `buildFragmentProxyUrl` rejects any
  remainder that would leave the target's origin+path (`../admin`,
  `//evil.example/x`, an absolute URL), because the target comes from a trusted
  manifest but the path after it comes from the browser.
- **The manifest cache is keyed by the registry-resolved version**, which is how
  Podium uses its own manifest `version` field: a `promote-fragment` changes the
  version, which invalidates the entry, so new proxy targets go live without a
  gateway restart and without a manifest fetch per request. A cache miss serves
  an empty target map (the route 404s) and refreshes in the background rather
  than making the request wait.

## 8. Page health → HTTP status (the `primary` semantic)

Zalando Tailor let a `primary` fragment's failure decide the page's response
code. We had no equivalent: a page whose **required** slot was entirely down
still answered `200`, so crawlers indexed degraded markup as real content and
success-rate monitoring saw a healthy page.

The channel is a hidden marker element in the page body, because in the Next App
Router a `page.tsx` cannot set a status or a header — only middleware and route
handlers can — while the gateway already reads the upstream body as text. It is a
`<div hidden data-…>` rather than a `<meta>` because it is an internal signal for
the gateway, not metadata about the document. React 19 **does** hoist a `<meta>`
rendered from a page component into `<head>` (verified by SSR probe; React 18,
which this repo used to be on, left it in `<body>` — invalid HTML), but `<head>`
is the document's public metadata surface and a degradation signal does not
belong there.

```tsx
// streaming pages
<Suspense fallback={null}>
  <PageHealthMetaStream execution={stream.execution} />
</Suspense>

// barrier pages (page-trade)
<PageHealthMeta execution={fragmentHtml.execution} />
```

which emits `<div hidden data-mvp-page-health="ok|degraded|unhealthy"
data-failed-slots="...">`. The gateway reads it with `readPageHealthFromHtml`
(read-only — the body is still returned byte-for-byte) and answers
`503` + `Retry-After` when the value is `unhealthy`.

- Only `unhealthy` (a **required** slot failed) changes the status. `degraded`
  (an optional slot failed) stays `200`, because partial degradation is a
  designed feature (§4).
- A page that does not stamp the marker is unaffected — pages opt in.
- `SHELL_REQUIRED_FAILURE_STATUS=0` keeps the upstream status, for a deployment
  that is still stabilizing a new fragment.

Pages with a required slot today: `page-home` (`promotion`), `page-markets`
(`marketsTable`), `page-portfolio` (`portfolioSummary`), `page-trade`
(`marketHeader`).

## Related docs

- [OPERATIONS.md](./OPERATIONS.md) — lifecycle commands and their JSON envelopes.
- [CONTRACTS.md](./CONTRACTS.md) — schema index for every contract named here.
- [INTERACTION.md](./INTERACTION.md) — cross-island bus/store/ACL model.
- [DELIVERY.md](./DELIVERY.md) — affected-set model and deploy gates.
- [DEMOS.md](./DEMOS.md) — which page demonstrates which composition capability.
