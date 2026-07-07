# open-orders fragment

SSR fragment service (Fastify) for the trade-demo **A2-orders** slot: the
working-orders table (patch-only realtime, with cancel controls). Mirrors
`fragments/trades-feed` / `fragments/order-book`.

- **Port:** 4209 (default)
- **Render strategy:** `dynamic-ssr` (user-private realtime, no TTL)
- **Data dependency:** `orders` (contract C5 global id; realtime user-private,
  poll-fallback over fixture via contract C4 `createTradeDataClient`)
- **Assets:** `@mvp/trade-client` (shared, deduped) + `/assets/open-orders.patch.js`
  (tiny vanilla patch shim) + `/assets/open-orders.css`. **No React** ships from
  the fragment — patch-only.
- **Budget:** JS ≤ 30KB / CSS ≤ 10KB (framework gate); doc 02 §3 draft target 12KB/8KB.

## Endpoints

`/health` · `/metrics` · `/manifest` · `/assets` · `/budget` · `POST /render`

## Patch model (pure logic, `src/patch.ts`)

- **Order frame → row upsert / fill removal** — `applyOrderFrame` /
  `reconcileOrders` diff the full working set keyed by `orderId`; a fully-filled
  order (`filled >= size`) becomes a `remove`, everything else an `upsert`.
- **Cancel flow** — `cancelOrderFlow(orderId, io)` drives the frozen
  `cancelOrder` mutation (contract C3). `execute` is called with NO
  `options.invalidates` (declared `["orders:{user}"]` used); the `invalidate`
  handler resolves `{user}` via `resolveUserTags` before hitting the data
  client, so a cancel only ever invalidates `orders:<user>`.
- **Symbol switch** — subscribes/filters on `TRADE_ACTIVE_SYMBOL`.

## Register (agent K, scripts only — not run here)

```
pnpm exec tsx scripts/register-fragment.mts \
  --name open-orders --version 0.1.0 \
  --service-url http://localhost:4209 --channel canary --with-compose
```

Then mount into the trade page `openOrders` slot with `scripts/mount-slot.mts`.
