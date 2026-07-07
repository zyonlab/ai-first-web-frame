# market-header

Near-realtime SSR fragment for the trade terminal top bar (A2-header slot). Renders one dense
stat row — pair, mark/oracle price, 24h change, funding, 24h volume, and a next-funding countdown
placeholder — seeded from the frozen mock ticker + funding fixtures. Ships a small React island
(`@mvp/trade-client`) that near-realtime-patches mark/change/countdown and resubscribes when the
active symbol changes (`TRADE_ACTIVE_SYMBOL`).

Commands:

- `pnpm --filter @mvp/fragment-market-header dev`
- `pnpm --filter @mvp/fragment-market-header test`
- `pnpm --filter @mvp/fragment-market-header build`
- `pnpm --filter @mvp/fragment-market-header start`

Contract points: **C5** `sourceIds.ticker(sym)` / `sourceIds.funding(sym)`, **C4**
`createTradeDataClient(ctx).readData` / `.subscribe`, **C3** `TRADE_ACTIVE_SYMBOL` resubscription,
**C2** `data-island="marketHeader"` mount markup + inline JSON snapshot.
