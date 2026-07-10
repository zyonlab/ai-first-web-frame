// See react.ts. `@mvp/trade-contracts` (domains/trade-contracts) is the one
// domain package the order-form island's browser build actually imports at
// runtime (createMockMatchingEngine, placeOrder, resolveUserTags,
// applyLeverageChange, applyOrderbookPrice, plus the slice-name constants).
// It has no React dependency of its own, so it bundles standalone here (no
// shared chunk needed with the react/react-dom entries).
export * from "@mvp/trade-contracts";
