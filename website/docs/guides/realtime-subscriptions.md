# Realtime subscriptions

A server-rendered panel that stays live without React: subscribe to a source, fold each frame
into an in-place DOM patch. **The fragment declares what it listens to; the page only binds
parameters.**

## Why it is built this way

The first version put all of it in the page: which fragments were live, which source each needed,
and how to patch each one's DOM — about 540 lines in `apps/page-trade/src/realtime.ts`. A
fragment therefore could not become live, or change what it subscribed to, without a page edit.
That breaks the claim that a fragment is the unit of deployment.

## 1. Declare in the fragment manifest

```ts
// fragments/order-book/src/manifest.ts
dataDependencies: ["book.l2.<symbol>"],   // what SSR reads once
subscriptions:    ["book.l2.<symbol>"],   // what the browser holds open
```

These are **source-id templates** in the existing `<param>` vocabulary. `GET /manifest` publishes
them, so a new fragment version can change what it listens to and ship on its own.

A template with no placeholder (`positions`) is a global source.

## 2. Ship a `LivePanel` from the fragment

```ts
// fragments/order-book/src/live.ts
import type { LivePanel } from "@mvp/runtime/live";
import { orderBookManifest } from "./manifest";

export const orderBookLivePanel: LivePanel = {
  fragment: orderBookManifest.name,          // matches the SSR root's data-fragment
  subscriptions: orderBookManifest.subscriptions,
  mount({ node, params, remounted }) {
    let prev = remounted ? null : ladderFromDom(node, params.symbol, depth);
    return {
      onFrame(_source, data) { /* diff + patch in place */ },
      stop() { /* optional */ },
    };
  },
};
```

Export it as `./live` in the fragment's `package.json`.

## 3. The page supplies only parameters and a client

```ts
import { startLivePanels } from "@mvp/runtime/live";

const controller = startLivePanels({
  root,
  panels: TRADE_LIVE_PANELS,
  params: { symbol },
  subscribe: (source, onFrame) => client.subscribe(source, (e) => onFrame(e.data)),
  onParamsChange: (next) => { client = makeClient([next.symbol]); },
});

controller.setParams({ symbol: "ETH" });
controller.stop();
```

The driver never sees the data client — only resolved source ids.

## `remounted` is the subtle part

On a parameter change every panel is torn down and re-mounted (the data client is scoped to a
symbol set, so a partial swap would leave panels on a stale client). What is **not** uniform is
`remounted`: it is `true` only for panels that bind a parameter that actually changed.

That is how a panel knows whether its SSR DOM is still trustworthy:

| Panel | Subscription | On symbol switch |
| --- | --- | --- |
| `order-book` | `book.l2.<symbol>` | `remounted: true` → rebuild; rendered rows hold the old symbol's prices |
| `trades-feed` | `trades.<symbol>` | `remounted: true` → clear the tape |
| `positions-table` | `positions` | `remounted: false` → **rows survive**; positions are account-global |

Before, that rule was hand-written in the page. Now it is derived from the declarations.

## Degradation

A panel whose fragment did not render, or rendered its fallback (`data-fallback`), is **skipped**,
not mounted — composition already degraded that slot and a subscription must not resurrect it. A
panel that throws at mount or on a frame is reported through `onError` and dropped; the rest of
the page stays live.

## Helpers

`templateParams(template)` → the bound parameter names.
`resolveSourceTemplate(template, params)` → the concrete id, **throwing** if a bound parameter is
missing rather than subscribing to an id containing a literal `<symbol>` that would never deliver
a frame.

Shared DOM shim for patch panels: `panelDocument`, `setFieldText`, `fieldText`,
`parseFieldNumber`, `cssEscapeAttr`.

## Keeping page and fragment honest

`apps/page-trade/src/liveContract.test.ts` fails the build if a panel declares a template that
does not resolve to a known source id, or binds a parameter the page cannot supply — which would
otherwise mount a panel that silently never receives a frame.

## The remaining coupling

The page still **statically imports** each live panel and lists it in `TRADE_LIVE_PANELS` (two
lines). There is no runtime module loading in this repository, so that import has to exist,
exactly as it does for the React island registry. What no longer requires a page change is the
part that matters for deployment: *what an existing fragment subscribes to.*
