# markets-table fragment (A2-markets slot)

Pure SSR fragment for the `/markets` page: a near-realtime markets list table.
Each row is a **deep link** `<a href="/trade/<SYMBOL>">` so the list works with
no JS and drives the markets -> trade navigation. Reads the C5 `markets.index`
source (plus per-symbol `ticker`/`funding`) through ONE shared C4
`createTradeDataClient`. `cached-ssr` with a short 5s TTL keeps the list fresh.

Endpoints: `/health` `/metrics` `/manifest` `/assets` `/budget` and
`POST /render`. Default port 4212.
