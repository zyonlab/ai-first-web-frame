# trades-feed

SSR fragment service for the realtime trades tape (recent prints, newest first).

Patch-only: the fragment ships no React. SSR renders the last N prints from the
frozen A0 fixtures/mock; a tiny vanilla patch client (declared as a shared
`@mvp/trade-client` chunk plus this fragment's own patch asset) prepends new
prints, trims to N, and clears + resubscribes on `TRADE_ACTIVE_SYMBOL` change.

Commands:

- `pnpm --filter @mvp/fragment-trades-feed dev`
- `pnpm --filter @mvp/fragment-trades-feed test`
- `pnpm --filter @mvp/fragment-trades-feed build`
- `pnpm --filter @mvp/fragment-trades-feed start`

Default port: 4206. Env override: `TRADES_FEED_URL` rewrites serviceUrl/manifestUrl.
