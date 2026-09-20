# Islands and hydration

A fragment ships SSR HTML plus an inline JSON snapshot. The page hydrates a React island over
that markup — but only if a version handshake passes.

## The markup contract

```html
<div data-island="orderForm">
  <script type="application/json" data-island-props="orderForm">
    {"props":{…},"slice":"trade.order-draft","fragment":"order-form",
     "version":"0.1.0","contractHash":"…"}
  </script>
  <!-- server-rendered markup -->
</div>
```

`IslandSnapshotSchema`: `props` (record, defaults `{}`), and optional `slice`, `fragment`,
`version`, `contractHash`.

## Registering and hydrating

```ts
import { registerIsland, hydrateIslands } from "@mvp/islands";
import { OrderFormIsland, OrderFormIslandPropsSchema } from "@mvp/fragment-order-form/island";

registerIsland("orderForm", OrderFormIsland, {
  expect: { fragment: "order-form", version: "0.1.0" },
  propsSchema: OrderFormIslandPropsSchema,
});

hydrateIslands(document);   // finds every [data-island], mounts what passes
```

Other entry points: `mountIsland` (one node), `readIslandSnapshot`, `getIsland`,
`clearIslandRegistry`, `configureIslandRuntime`.

## The handshake, and what failure means

Hydration is skipped — leaving the SSR markup untouched — for four distinct reasons
(`SnapshotMismatchInfo.reason`):

| Reason | Cause |
| --- | --- |
| `version-mismatch` | snapshot `version` ≠ the page's expected version |
| `contract-hash-mismatch` | the payload contract changed under the same version |
| `invalid-snapshot` | the JSON does not satisfy `IslandSnapshotSchema` |
| `invalid-props` | snapshot props fail the island's own `propsSchema` |

**Skipping is the success case for a mismatch.** The page keeps working: server-rendered,
readable, indexable, just not interactive in that one spot. What must never happen is mounting a
component against props it does not understand — an order form that hydrates without the
instrument's tick size and lot size would accept orders the exchange rejects.

Install a handler to observe it:

```ts
configureIslandRuntime({
  onSnapshotMismatch: (info) => reportDrift(info),  // {island, expected, actual, reason}
});
```

This is the honest limit of the design versus Module Federation: MF *negotiates* and loads a
matching version; we only *detect* and decline. There is no runtime remote loading here.

## Adding a required prop is a breaking change

If you add a required field to an island's `propsSchema`, every SSR snapshot produced by an older
fragment build fails `invalid-props` and those islands stop hydrating — by design. Either bump
the version and roll the fragment first, or make the field optional with a safe default.

This is not theoretical: adding three required fields to the order form's props schema made a
hand-built test snapshot stop hydrating, which is exactly the production behaviour you want when
an old fragment meets a new page bundle.

## Budget

Islands are the main client-JS cost. Each fragment's `jsBytes` budget is measured as a minified
esbuild bundle of its client entry with `react`, `react-dom` and `@mvp/*` **external** — shared
vendor is charged to the consuming page, not to each fragment. `audit:bundle` enforces it.

Four islands currently exceed the advisory `large-client-component` size guideline
([F10](../known-limitations.md#f10)).
