// Scaffolding only — no real runtime code yet. Per
// docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2, this package becomes the future
// home of `packages/trade-client/src/chart.tsx` — the trade demo's
// self-contained canvas 2D candle/depth chart adapter, which is demo-only
// (not a generic framework capability) per plan §2.2's move table.
//
// This placeholder only proves the package resolves, builds, and typechecks
// cleanly ahead of that move. The real migration is a separate, blocked P1
// task — see docs/ARCHITECTURE_REFACTOR_PLAN.md §8 (Phase P1). The tsconfig
// already allows `.tsx` sources so the real move needs no further setup.
export const __placeholder = true;
