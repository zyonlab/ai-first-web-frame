# funding-bar

Pure-SSR fragment service for the funding-rate bar: current funding rate
(up/down semantic color), next-funding countdown, and oracle price. No React
island — the only client JS is an optional tiny vanilla countdown tick.

Commands:

- `pnpm --filter @mvp/fragment-funding-bar dev`
- `pnpm --filter @mvp/fragment-funding-bar test`
- `pnpm --filter @mvp/fragment-funding-bar build`
- `pnpm --filter @mvp/fragment-funding-bar start`

Default port: 4210.
