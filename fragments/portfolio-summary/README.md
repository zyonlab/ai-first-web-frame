# portfolio-summary

Pure-SSR fragment service for the A2-portfolio slot: a portfolio overview
(total equity, unrealized PnL with up/down semantic color, margin usage meter,
withdrawable) plus an open-positions table (symbol → `/trade/<SYMBOL>` deep
link, side, size, entry, mark, uPnL). Request-time (`dynamic-ssr`, ttl 0),
user-private, no React island — zero framework JS, no-JS readable.

Reads three frozen C5 sources through one shared C4 `createTradeDataClient`:
`account` (request-time), `positions` (realtime, poll fallback), `balances`
(request-time).

Commands:

- `pnpm --filter @mvp/fragment-portfolio-summary dev`
- `pnpm --filter @mvp/fragment-portfolio-summary test`
- `pnpm --filter @mvp/fragment-portfolio-summary build`
- `pnpm --filter @mvp/fragment-portfolio-summary start`

Default port: 4213.
