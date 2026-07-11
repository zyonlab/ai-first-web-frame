/**
 * Trade-demo data sources (A1-data slot).
 *
 * Additive layer on top of the `@mvp/data` core (`createDataClient`,
 * `defineDataSource`, `subscribeData`, `createDataKey`, `CacheAdapter`, ...):
 * the canonical source-id registry (contract C5), a `DataDependency` +
 * loader definition per trade source (freshness/privacy/cache aligned to
 * docs/trade-demo/03-data-architecture.md §1), and the `createTradeDataClient`
 * ergonomic helper (contract C4) that pre-registers them all and auto-wires the
 * frozen A0-mock transport for realtime feeds.
 *
 * Also owns the trade-only mock realtime transport (seeded frame generators,
 * deterministic fixtures, and `createMockSubscriptionTransport`) under
 * `./transport` — this is the A0-mock slot, moved here from `@mvp/data`
 * because it is entirely trade-market-data-specific (`OrderbookL2Frame`,
 * `TradePrintFrame`, `TickerFrame`, `FundingFrame`, `Candle`, ...), not a
 * framework-generic primitive.
 *
 * Nothing here modifies the core — it only composes it.
 */

export * from "./sourceIds";
export * from "./tradeClient";
export * from "./tradeSources";
export * from "./transport";
