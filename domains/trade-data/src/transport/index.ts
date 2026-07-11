/**
 * Mock realtime data transport for the trade demo (A0-mock slot).
 *
 * Public surface:
 * - Deterministic seeded PRNG (`prng`): reproducible randomness with no
 *   `Math.random`/`Date.now`.
 * - Pure frame generators (`frames`): orderbook L2, trades, ticker/mark,
 *   funding, and candles — each a pure `(state) -> { state, frame }` step.
 * - `createMockSubscriptionTransport` (`mockTransport`): a self-driving
 *   implementation of the existing `SubscriptionTransport` interface.
 * - Deterministic `tradeFixtures` (`fixtures`) for SSR first paint + tests.
 *
 * All frame shapes align with docs/trade-demo/03-data-architecture.md §1.
 */

export * from "./fixtures";
export * from "./frames";
export * from "./mockTransport";
export * from "./prng";
