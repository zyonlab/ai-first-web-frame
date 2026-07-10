# @mvp/trade-data

The trade domain's data layer: the canonical trade source-id registry
(`sourceIds`, `parseSourceId`, `tradeSourceRegistry`), the per-source
`DataDependency` + loader definitions (`orderbookSource`, `tickerSource`,
`accountSource`, ...), and the `createTradeDataClient` ergonomic helper that
pre-registers them all and auto-wires the mock realtime transport.

Moved out of `packages/data` in the Phase P1 re-layering migration (§2.2 Move
C); see
[docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2](../../docs/ARCHITECTURE_REFACTOR_PLAN.md#22-moves-mechanical-one-pr-behavior-preserving).
The generic `createDataClient` / `readData` / `preloadData` / `mutateData` /
`subscribeData` / cache-adapter core, plus the mock transport / frame
generators / fixtures, stay in `@mvp/data` — this package depends on it.
