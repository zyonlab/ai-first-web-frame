# @mvp/store

A generic client-side slice store built on `@mvp/interaction`
(`createSliceStore`, `useStoreSlice`). Domain-agnostic: the slice map and the
`InteractionContract`s that back it are supplied by the caller (e.g. a domain
package like `@mvp/trade-contracts`) at construction time — this package has
no domain vocabulary of its own.

Moved here from `packages/trade-client/src/store.ts` in the Phase P1
re-layering migration (§2.2 Move A), renaming `createTradeStore` ->
`createSliceStore` and `TradeStore` -> `SliceStore` to match; see
[docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2](../../docs/ARCHITECTURE_REFACTOR_PLAN.md#22-moves-mechanical-one-pr-behavior-preserving).
