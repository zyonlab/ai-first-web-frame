# DEMOS.md — demo capability index

Machine-actionable index answering "which page proves which capability?"
(refactor plan §6). Each of the 5 composed pages (`apps/page-{home,product,
markets,portfolio,trade}`) declares an optional `demonstrates: string[]` on
its `PageManifest` (`packages/contracts/src/index.ts`), populated in that
page's `src/manifest.ts`. Every value below was verified by hand against the
page's actual `src/manifest.slots.json` + `src/fragmentSlots.ts` (+
`app/**/page.tsx`, `src/hydrate*.tsx` for page-trade) — not copied from a
plan doc — as of this writing. Re-verify before trusting a stale copy.

## Index

| Page | Route | `demonstrates` | Key files |
| --- | --- | --- | --- |
| `page-home` | `/` | `composition:static+cached-ssr+dynamic-ssr`, `streaming:suspense-per-slot`, `fallback-isolation`, `trace-panel` | `apps/page-home/src/manifest.slots.json`, `apps/page-home/src/fragmentSlots.ts` (`streamHomeFragmentSlots`), `apps/page-home/app/page.tsx` |
| `page-product` | `/product/:id` | `ttl-cache-freshness`, `reserved-slots`, `streaming:suspense-per-slot` | `apps/page-product/src/manifest.slots.json` (`promotion` slot), `apps/page-product/src/fragmentSlots.ts` (`streamProductFragmentSlots`), `apps/page-product/app/product/[id]/page.tsx` (hand-rendered `price-panel` aside) |
| `page-markets` | `/markets` | `cached-ssr-freshness`, `fallback-isolation`, `streaming:suspense-per-slot` | `apps/page-markets/src/manifest.slots.json` (`marketsTable` slot), `apps/page-markets/src/fragmentSlots.ts` (`streamMarketsFragmentSlots`), `apps/page-markets/app/markets/page.tsx` |
| `page-portfolio` | `/portfolio` | `private-data-dynamic-ssr`, `ttl-cache-freshness`, `fallback-isolation`, `streaming:suspense-per-slot` | `apps/page-portfolio/src/manifest.slots.json` (`portfolioSummary`, `pnlChart` slots), `apps/page-portfolio/src/fragmentSlots.ts` (`streamPortfolioFragmentSlots`), `apps/page-portfolio/app/portfolio/page.tsx` |
| `page-trade` | `/trade/:symbol` | `dag-scheduling`, `cross-island-interaction:typed-bus`, `island-version-handshake`, `layout-hints`, `runtime-island-assets:spike` | `apps/page-trade/src/fragmentSlots.ts`, `apps/page-trade/src/hydrate.tsx`, `apps/page-trade/src/hydrateSpike.tsx`, `apps/page-trade/src/spikeImportMap.ts` |

## Capability definitions

- **`composition:static+cached-ssr+dynamic-ssr`** — a single page mixes all
  three non-cached-alias render strategies across its slots in one request
  (`page-home`: `staticEditorial` is `static`, `promotion` is `cached-ssr`,
  `recommendations` is `dynamic-ssr`).
- **`cached-ssr-freshness`** — a slot uses the `cached-ssr` strategy with a
  short `cachePolicy.ttl` for a near-realtime, still-cacheable read
  (`page-markets`'s `marketsTable`, ttl 5s).
- **`ttl-cache-freshness`** — a slot caches its response by
  `cachePolicy.ttl` under the `ttl-cache` strategy family (`page-product`'s
  `promotion`, ttl 300s; `page-portfolio`'s `pnlChart`, ttl 60s). Both
  slots spell the strategy as `"ttl-cache"` (the deprecated `"isr"` alias
  was codemodded away; `normalizeRenderStrategy()` in
  `packages/contracts/src/index.ts` still accepts the alias for backwards
  compatibility).
- **`private-data-dynamic-ssr`** — a required slot renders `dynamic-ssr`
  with `cachePolicy.ttl: 0` because its data is user-private and must never
  be cached (`page-portfolio`'s `portfolioSummary`: equity, margin usage,
  PnL).
- **`reserved-slots`** — a manifest slot is marked `reserved: true`,
  excluded from `fragmentSlots.gen.ts` by
  `packages/registry/src/codegen.ts`, and hand-rendered outside the runtime
  scheduler instead (`page-product`'s `price-panel`).
- **`fallback-isolation`** — a required slot's fragment-service failure
  degrades that slot to fallback markup instead of failing the page
  (`executeFragmentSlots`/`streamFragmentSlots` called with
  `onRequiredFailure: "fallback"`). Present on `page-home`, `page-markets`,
  `page-portfolio`.
- **`streaming:suspense-per-slot`** — the page uses `streamFragmentSlots`
  (not the blocking `executeFragmentSlots`) and wraps each slot in its own
  `<Suspense><FragmentSlotStream/></Suspense>` boundary so slots flush to
  the client independently as they settle. Present on four of the five
  pages: `page-home`, `page-product`, `page-markets`, `page-portfolio`
  (each exports a `stream*FragmentSlots` entry point built on
  `streamFragmentSlots`; rolled out by `feat/streaming-rollout`, W3-A,
  PR #14). The one deliberate exclusion is `page-trade`, which stays on
  the blocking barrier API (`fetchTradeFragmentSlots` +
  `executeFragmentSlots`) because its `trade-nav.test.tsx` renders the
  page through plain `react-dom/server`, which cannot execute async
  Server Components outside Next's real RSC runtime (rationale recorded
  in the W3-A section of `docs/REMEDIATION_PLAN.md` and PR #14).
- **`trace-panel`** — a rendered `<section data-request-trace="...">` (or,
  for `page-trade`, `<TraceDrawer>`) exposes the per-request dependency-graph
  trace log built by `@mvp/observability`'s `createRequestTrace`. Verified
  present on **all five** composed pages (not just `page-home`); it is
  listed here only for `page-home` because that page is this index's
  reference example for the wider diagnostics/tracing pattern (scheduler
  health + render-strategy samples + trace log together). Do not read its
  absence from another page's list as "that page has no trace panel."
- **`dag-scheduling`** — `executeFragmentSlots` runs with a shared
  data-dependency node (`trade-account`) that several slots declare via
  `dataDependencies`, fanning a single resolve out to every dependent slot
  instead of each slot re-fetching it (`page-trade`: `orderForm`,
  `positions`, `accountBar` all depend on `trade-account`). `page-product`
  runs a comparable DAG internally (`product-summary` fanning into
  `product-price`/`product-promotion`) but is not tagged with this
  capability here — see "on `demonstrates` as a differentiator" below.
- **`cross-island-interaction:typed-bus`** — multiple client islands share
  one `InteractionBus` instance and exchange typed, contract-defined slices
  from `@mvp/trade-contracts` (`TRADE_ACTIVE_SYMBOL`,
  `TRADE_ORDER_DRAFT_PRICE`, `TRADE_LEVERAGE`) instead of each island
  running an isolated private bus (`page-trade`'s `registerTradeIslands` in
  `src/hydrate.tsx`).
- **`island-version-handshake`** — island registration passes
  `expectedVersion` (the fragment's own manifest `version`) to
  `registerIsland` (`@mvp/islands`); a live SSR snapshot whose version
  disagrees skips hydration and keeps the SSR HTML static instead of
  mis-hydrating (C2 handshake). All four `page-trade` islands
  (`marketHeader`, `chart`, `accountBar`, `orderForm`) do this.
- **`layout-hints`** — fragments declare a `layoutHint` (`{ shape, fills,
  minHeight, aspect }`) on their own manifest (e.g.
  `fragments/order-book/src/manifest.ts`), and
  `tools/release-tools/src/layout-advisories.ts` turns it into mount-time
  advisory warnings so a fragment isn't wired into a pane too small/wrong-
  shaped for it. `layoutHint` is a framework-wide, per-fragment concept
  (not page-trade-specific), but `page-trade`'s dense multi-fragment grid is
  the demo where getting this wrong previously produced a real, observed
  defect (see this repo's memory note on the order-book layout gap), so it
  is listed as `page-trade`'s representative demonstration.
- **`runtime-island-assets:spike`** — a page dynamically `import()`s an
  island component at runtime via a browser import map, resolved from the
  fragment registry's optional `assetsUrl`, instead of statically bundling
  it at build time (C3 spike). `page-trade`'s `src/hydrateSpike.tsx` +
  `src/spikeImportMap.ts` do this for the `order-form` fragment only — it
  is explicitly a spike, not rolled out further (see
  `docs/REMEDIATION_PLAN.md`'s "Deliberately NOT in this plan").

## On `demonstrates` as a differentiator

Some real capabilities (e.g. a per-request DAG in `page-product`, the
`trace-panel` pattern on every page) are intentionally **not** repeated on
every page whose code proves them. `demonstrates` is meant as an index of
each page's most distinguishing capabilities, not an exhaustive fact table —
see the capability definitions above for the honest "where else is this also
true" caveats before assuming a missing tag means "not implemented here."

## Does `demonstrates` surface through an HTTP route?

No — verified, not assumed. Fragments (`fragments/*/src/server.ts`) each
serve their own `FragmentManifest` at `GET /manifest`, but the five page
apps (`apps/page-*`, Next.js) do **not** expose an equivalent HTTP route for
their `PageManifest` object. `PageManifestSchema` is exercised at runtime
only for its `.shape.slots.element` (by `packages/registry/src/slots.ts` and
`src/codegen.ts`, to validate/generate the slot array) — the full page
manifest object, including `demonstrates`, is never `.parse()`d against a
live `homePageManifest`/etc. anywhere in the codebase today. In practice
`demonstrates` currently flows to: (1) this file, hand-verified; (2) any
tooling or agent that reads `apps/page-*/src/manifest.ts` directly; (3) the
`packages/contracts` schema/test suite. It does **not** yet flow through
`src/metadata.ts` (which only reads `manifest.seo`) or any live page
response. Wiring a page-level `/manifest` (or `/api/manifest`) route that
serves the full parsed `PageManifest` — so `demonstrates` is agent-readable
over HTTP the same way a fragment's manifest already is — is a reasonable
follow-up but is out of this task's scope (`packages/contracts/src/index.ts`,
`apps/*/src/manifest.ts`, `docs/DEMOS.md`, `llms.txt` only).
