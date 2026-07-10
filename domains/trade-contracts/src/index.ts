// Scaffolding only — no real runtime code yet. Per
// docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2, this package becomes the future
// home of `packages/interaction/src/trade/*` (slices.ts, mutations.ts,
// flows.ts): the trade domain's interaction-bus contracts, mutations, and
// flows. That move also drops `export * from "./trade"` from
// `packages/interaction/src/index.ts`, so the framework facade stops
// re-exporting domain vocabulary (plan §2.1, goal B3).
//
// This placeholder only proves the package resolves, builds, and typechecks
// cleanly ahead of that move. The real migration is a separate, blocked P1
// task — see docs/ARCHITECTURE_REFACTOR_PLAN.md §8 (Phase P1).
export const __placeholder = true;
