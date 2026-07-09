// Scaffolding only — no real runtime code yet. Per
// docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2, this package becomes the future
// home of the generic parts of `packages/trade-client/src/store.ts`
// (`createTradeStore` / `useStoreSlice`), renamed `createSliceStore` when the
// real move happens, since the store client is a generic
// `@mvp/interaction`-backed store with no trade-specific vocabulary of its
// own.
//
// This placeholder only proves the package resolves, builds, and typechecks
// cleanly ahead of that move. The real migration is a separate, blocked P1
// task — see docs/ARCHITECTURE_REFACTOR_PLAN.md §8 (Phase P1).
export const __placeholder = true;
