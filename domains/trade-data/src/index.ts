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
 * Nothing here modifies the core or the transport — it only composes them.
 */

export * from "./sourceIds";
export * from "./tradeClient";
export * from "./tradeSources";
