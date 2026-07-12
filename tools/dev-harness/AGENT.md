# tools/dev-harness — AGENT.md

## What this package is for

`tools/dev-harness` is the single-component dev harness
(docs/AI_NATIVE_DEVX.md §4, Phase 3): run ONE fragment in isolation with its
**contract-mocked world** derived from its manifest, instead of standing up
the other 21 services. It is **not a workspace package** (no `package.json`)
— two pure, unit-tested modules consumed by the `pnpm dev:component` CLI
(`scripts/dev-component.mts`), which does the I/O: POSTs to the one running
fragment service's `/render` and serves the preview (default port 4300).

- `src/mock-world.ts` — manifest in → isolated-dev spec out: which C3
  store/bus channels to seed (with their contract initial values from
  `domains/trade-contracts`' `initialTradeSlices`), which C5 data sources to
  feed with `@mvp/data`'s deterministic mock transport, which channels you
  can publish to drive it, which to observe, and the `layoutHint` the
  preview pane must honor.
- `src/harness-page.ts` — pure HTML string generation for the preview: the
  fragment's real SSR inside a dark design-system-themed pane sized to its
  `layoutHint` (`shape` → pane width, `minHeight`, `fills` → flex stretch),
  next to a sidebar listing the mocked world.

## Entry points

- `describeMockWorld(manifest: FragmentManifestLike): MockWorld` — pure.
  Returns `{ component, seededSlices, mockDataSources, injectSlices,
  observeSlices, layoutHint? }` where `seededSlices` maps each
  `manifest.consumes.slices` channel to its `initialTradeSlices` value,
  `mockDataSources` is the deduped union of `dataDependencies` +
  `consumes.dataSources`, `injectSlices` = consumed channels (publish these
  to drive the component), `observeSlices` = `produces.slices` (assert on
  these). `FragmentManifestLike` comes from
  `tools/release-tools/src/unit-graph`.
- `renderHarnessPage(opts: HarnessPageOptions): string` — pure. `opts` is
  `{ name, themeCss, fragmentHtml, world: MockWorld, serviceUrl? }`; returns
  the full `<!doctype html>` page. `fragmentHtml` is embedded **unescaped**
  (it is the fragment's own SSR, which already carries its inlined CSS);
  every sidebar/chip value is HTML-escaped. Pane width by shape:
  `ladder`/`panel` → 320px, `bar`/`table` → `min(1100px, 100%)`, else
  `min(760px, 100%)`; `minHeight` defaults to 120px; `fills` toggles the
  pane child's flex from `0 0 auto` to `1 1 auto`.

**Command (CLI)**
```
pnpm dev:component order-book              # themed preview on :4300
pnpm dev:component order-form --port 4321
pnpm dev:component order-form --json       # print the mock-world spec, no server
```
Requires that one fragment's service to be running
(`docker compose up <name>` or its package `start`).

## Error taxonomy

- The two modules throw nothing on well-typed input: a manifest with no
  `consumes`/`produces` yields empty arrays/objects (the data-only-fragment
  case); a channel that has no entry in `initialTradeSlices` seeds
  `undefined` (the sidebar renders its sample as `{}`); a missing
  `layoutHint` falls back to the default pane (`panel` sizing hints in the
  header chips).
- The CLI is where failures live: an unknown fragment name, or the fragment
  service not running/`/render` failing, is reported by
  `scripts/dev-component.mts` — nothing in this directory does I/O.

## Example

Imports are written for where `docs:test` executes this snippet
(`tools/dev-harness/.docs-test-tmp/`).

```ts
import { describeMockWorld } from "../src/mock-world";
import { renderHarnessPage } from "../src/harness-page";

// The subset of fragments/order-book/src/manifest.ts the harness reads.
const world = describeMockWorld({
  name: "order-book",
  dataDependencies: ["book.l2.<symbol>"],
  consumes: {
    slices: ["trade.active-symbol"],
    dataSources: ["book.l2.<symbol>"], // duplicate of dataDependencies -> deduped
  },
  produces: { slices: ["trade.order-draft-price"] },
  layoutHint: { shape: "ladder", minHeight: 480, fills: true },
});

if (world.component !== "order-book") throw new Error("component name");
if (world.mockDataSources.join() !== "book.l2.<symbol>")
  throw new Error("data sources must be the deduped union");
// Consumed slices are seeded with their C3 contract initial values.
if (JSON.stringify(world.seededSlices["trade.active-symbol"]) !== '{"symbol":"BTC"}')
  throw new Error("seed must come from initialTradeSlices");
if (world.injectSlices.join() !== "trade.active-symbol") throw new Error("inject");
if (world.observeSlices.join() !== "trade.order-draft-price") throw new Error("observe");

const html = renderHarnessPage({
  name: "order-book",
  themeCss: ":root{--mvp-color-ink:#e6e6e6}",
  fragmentHtml: '<section data-fragment="order-book">SSR</section>',
  world,
  serviceUrl: "http://localhost:4205",
});
if (!html.includes('data-fragment="order-book"'))
  throw new Error("fragment SSR embeds unescaped");
if (!html.includes("min-height:480px")) throw new Error("layoutHint sizes the pane");
if (!html.includes("width:320px")) throw new Error("ladder shape -> 320px pane");
if (!html.includes("trade.active-symbol")) throw new Error("sidebar lists inject channels");
```

## Accept

```
pnpm exec vitest run tools/dev-harness
```
Expected: Vitest exits 0. `src/mock-world.test.ts` covers spec derivation,
C3 initial-value seeding, and the data-only-fragment case;
`src/harness-page.test.ts` covers the hint-sized themed pane, the mocked
world sidebar, and escaping (sidebar values escaped, fragment SSR passed
through). For the live loop: `pnpm dev:component <fragment>` against that
fragment's running service.
