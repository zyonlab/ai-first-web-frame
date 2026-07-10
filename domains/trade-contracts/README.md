# @mvp/trade-contracts

The trade domain's interaction-bus contracts, mutations, and flows: the store
slice channel ids + payload schemas (`tradeSliceContracts`,
`tradeStoreContracts`, `TradeSlices`, `initialTradeSlices`), the place-order /
cancel-order mutation contracts (`placeOrder`, `cancelOrder`,
`createMockMatchingEngine`, `resolveUserTags`), and the three canonical-flow
reducers (`applyOrderbookPrice`, `applyLeverageChange`, `applySymbolSwitch`).

Moved here from `packages/interaction/src/trade/*` in the Phase P1
re-layering migration (§2.2 Move B); `packages/interaction` no longer
re-exports this domain vocabulary (`export * from "./trade"` was removed from
its facade). Depends on `@mvp/interaction` for the generic bus/mutation core
(`createInteractionBus`, `defineMutation`) and `@mvp/contracts` for
`InteractionContract`; see
[docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2](../../docs/ARCHITECTURE_REFACTOR_PLAN.md#22-moves-mechanical-one-pr-behavior-preserving).

Callers (fragments, `apps/page-trade`) import the generic slice-store /
island-runtime mechanics from `@mvp/store` / `@mvp/islands` and pull the
trade-specific contracts/constants from this package.
