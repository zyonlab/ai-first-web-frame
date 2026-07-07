# positions-table

SSR fragment service for the realtime positions table (open positions with
size / entry / mark / liq / uPnL + close controls).

Patch-only: the fragment ships no React. SSR renders the current positions
snapshot from the frozen A0 fixtures/mock (realtime, user-private — no mock
generator, so the data plane polls the fixture snapshot); a tiny vanilla patch
client (declared as a shared `@mvp/trade-client` chunk plus this fragment's own
patch asset) upserts / removes rows in place keyed by symbol, recolors uPnL by
sign, and clears + resubscribes on `TRADE_ACTIVE_SYMBOL` change.

Commands:

- `pnpm --filter @mvp/fragment-positions-table dev`
- `pnpm --filter @mvp/fragment-positions-table test`
- `pnpm --filter @mvp/fragment-positions-table build`
- `pnpm --filter @mvp/fragment-positions-table start`

Default port: 4208. Env override: `POSITIONS_TABLE_URL` rewrites
serviceUrl/manifestUrl.
