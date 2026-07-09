// Scaffolding only — no real runtime code yet. Per
// docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2, this package becomes the future
// home of the trade source registry and the `createTradeDataClient` helper
// currently appended to `packages/data/src/index.ts` (plus the trade-specific
// source loaders under `packages/data/src/sources/tradeClient.ts`).
//
// This placeholder only proves the package resolves, builds, and typechecks
// cleanly ahead of that move. The real migration is a separate, blocked P1
// task — see docs/ARCHITECTURE_REFACTOR_PLAN.md §8 (Phase P1).
export const __placeholder = true;
