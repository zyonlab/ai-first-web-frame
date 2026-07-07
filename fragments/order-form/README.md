# @mvp/fragment-order-form

SSR order-entry fragment for the trade demo (A2-form slot). Serves the
market/limit order form (size, leverage slider, buy/sell, reduce-only) as a
server-safe first paint plus a `data-island="order-form"` React island that
hydrates through `@mvp/trade-client`.

Default port **4205**. Endpoints: `/health /metrics /manifest /assets /budget`
and `POST /render`.

- **Render** (`src/render.ts`): request-time account/margin read via C4
  `createTradeDataClient` (`sourceIds.account`), form HTML, and the frozen C2
  island snapshot `<div data-island="order-form"><script
  type="application/json">{props,slice}</script></div>` (`slice = trade.order-draft`).
- **Island** (`src/island.tsx`, `"use client"`): subscribes to
  `trade.order-draft.price` (order-book click) + `trade.hovered-price`;
  publishes `trade.leverage` and `trade.order-draft`; submits via the frozen
  `placeOrder` mutation.
- **Pure logic** (`src/islandLogic.ts`, `src/placeOrderFlow.ts`): all C3
  reducers + the place-order flow, unit-tested with no DOM/React.

React/Radix are NOT bundled here — they ship once via the shared
`@mvp/trade-client` + `@mvp/ui/shadcn` chunks declared in the manifest.

Register (run by agent K, not here):

```
pnpm exec tsx scripts/register-fragment.mts \
  --name order-form --version 0.1.0 \
  --service-url http://localhost:4205 --channel canary
```
