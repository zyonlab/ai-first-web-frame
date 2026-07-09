// Scaffolding only — no real runtime code yet. Per
// docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2, this package becomes the future
// home of the generic parts of `packages/trade-client/src/island.tsx`
// (the island registry, `registerIsland`, `hydrateIslands`,
// `clearIslandRegistry`). Per plan §4.3.1, this is also where the future
// snapshot version-handshake logic (C2: `{fragment, version, contractHash}`
// verification, mismatch → skip hydration + keep SSR HTML + emit an
// observability event) will live.
//
// This placeholder only proves the package resolves, builds, and typechecks
// cleanly ahead of that move. The real migration is a separate, blocked P1
// task — see docs/ARCHITECTURE_REFACTOR_PLAN.md §8 (Phase P1). The tsconfig
// already allows `.tsx` sources so the real move needs no further setup.
export const __placeholder = true;
