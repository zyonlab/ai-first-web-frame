# account-bar

Request-time + realtime SSR fragment for the trade terminal account strip (A2-account slot). Renders
one dense stat row — equity, margin used, withdrawable — plus a small margin-usage meter, seeded from
the frozen mock `account` fixture. Ships a small React island (`@mvp/trade-client`) that recomputes a
leverage-driven margin preview when the order-form broadcasts `TRADE_LEVERAGE`, and patches the
committed margin numbers on the realtime `account` feed (live transport wired in P3).

Commands:

- `pnpm --filter @mvp/fragment-account-bar dev`
- `pnpm --filter @mvp/fragment-account-bar test`
- `pnpm --filter @mvp/fragment-account-bar build`
- `pnpm --filter @mvp/fragment-account-bar start`

Default port: **4207**.

Contract points: **C5** `sourceIds.account` (request-time, user-private), **C4**
`createTradeDataClient(ctx).readData` / `.subscribe`, **C3** `TRADE_LEVERAGE` subscription
(order-form → margin preview), **C2** `data-island="accountBar"` mount markup + inline JSON snapshot.

The `account` data node is **shared** with `order-form` and `positions-table`: one resolution per SSR
request feeds all three slots (spine §6 dedupe), so the runtime coalesces the read instead of
re-fetching per fragment.
