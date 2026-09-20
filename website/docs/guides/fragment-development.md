# Fragment development

A fragment is a Fastify service with one job: answer `POST /render` with HTML for a given
`{props, ctx}`.

## Anatomy

```
fragments/<name>/
  src/server.ts        ~20-line adapter over @mvp/fragment-host — do not hand-roll
  src/render.ts        the render function: {props, ctx} -> {html, assets, cache, metadata}
  src/manifest.ts      name, version, owner, renderMode, fallback, assets, budget, proxy,
                       dataDependencies, subscriptions
  src/budget.ts        the unit's performance budget
  src/data.ts          data access via @mvp/data / @mvp/request (never bare fetch)
  src/styles.ts        the scoped stylesheet emitted inline with the markup
  src/island.tsx       optional React island
  src/live.ts          optional non-React live panel
  tests/, Dockerfile, package.json, tsconfig.json, README.md, AGENT.md
```

## The host owns the HTTP surface

`createFragmentServer` from `@mvp/fragment-host` provides all eight routes, Prometheus metrics,
and trace export. Your `server.ts` supplies only identity and the render function:

```ts
import { createFragmentServer } from "@mvp/fragment-host";
import { orderBookManifest } from "./manifest";
import { orderBookBudget } from "./budget";
import { renderOrderBook } from "./render";

export const SERVICE_NAME = "order-book";

export function buildServer(options = {}) {
  return createFragmentServer({
    serviceName: SERVICE_NAME,
    port: 4204,
    manifest: orderBookManifest,
    budget: orderBookBudget,
    render: renderOrderBook,
    ...options,
  });
}
```

This is enforced, not merely recommended: `audit:deps` rule `fragment-server-not-hosted` fails
the build on a fragment that builds its own Fastify instance.

`render` receives `(request, { trace, now })`. Take the clock from `now` rather than
`Date.now()` if your output contains time — that is what makes render output testable and is why
the countdown in `market-header` is deterministic under test.

## Fallback is declared, not improvised

`manifest.fallback` is an HTML string the composition layer substitutes when your service is
slow, erroring, or skipped. Keep it self-describing and carry the same
`data-fragment="<name>"` root plus `data-fallback="true"`:

```ts
fallback: '<section data-fragment="order-book" data-fallback="true">Order book unavailable</section>',
```

The `data-fallback` attribute matters at runtime, not just visually: the live-panel driver skips
any node carrying it, so a degraded slot is never brought back to life by a subscription.

## Data access

No bare `fetch(...)` in business code — `audit:deps` rule `raw-fetch-in-business-code` fails the
build. Use `@mvp/request` (contract-checked HTTP with timeouts and typed errors:
`RequestContractError`, `RequestPolicyError`, `RequestTimeoutError`) or `@mvp/data` (the source
registry with cache adapters, freshness validation and subscriptions).

A second rule, `fetch-without-timeout`, catches a `fetch` that has no abort path at all.

## Declaring what you need

Two separate fields, and the difference matters:

```ts
// what SSR reads once
dataDependencies: ["book.l2.<symbol>"],
// what the browser panel holds open
subscriptions: ["book.l2.<symbol>"],
```

`order-form` shows the asymmetry: it reads `account` at render time and subscribes to nothing.

## Styling

CSS ships inline with the markup in a `<style data-fragment-style="<name>">` block from
`src/styles.ts`. `audit:css` measures total bytes, unused bytes, duplicated rules, global
selectors and `!important` count, and enforces each fragment's `cssBytes` ceiling. A class name
never referenced from source counts as unused bytes — which is why fragments that apply classes
only in browser patch code export a `*_CLASSES` constant so the reference is visible.

## Checklist before you ship

```sh
pnpm --filter @mvp/fragment-<name> test
pnpm verify:unit --name <name>     # builds the closure, boots it, checks version agreement
pnpm verify                        # all 14 gates
```
