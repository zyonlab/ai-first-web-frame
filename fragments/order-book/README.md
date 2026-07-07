# order-book

Realtime L2 order-book SSR fragment (trade demo, A2-book slot). Renders a
high-density bid/ask ladder with CSS depth bars + spread strip from the frozen
mock transport / fixtures, and ships a patch-only vanilla island (no React) that
publishes `TRADE_ORDER_DRAFT_PRICE` on row click and `TRADE_HOVERED_PRICE` on
hover. Default port `4204` (override with `PORT`).

Commands:

- `pnpm --filter @mvp/fragment-order-book dev`
- `pnpm --filter @mvp/fragment-order-book test`
- `pnpm --filter @mvp/fragment-order-book build`
- `pnpm --filter @mvp/fragment-order-book start`
