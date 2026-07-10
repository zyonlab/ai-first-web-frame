# @mvp/islands

Scaffolding package, not yet populated with real code. This is the future home
of the generic parts of `packages/trade-client/src/island.tsx` (the island
registry: `registerIsland`, `hydrateIslands`, `clearIslandRegistry`) once the
Phase P1 re-layering migration splits `packages/trade-client` between this
framework package and the trade domain layer. Per plan §4.3.1 this is also
where the future snapshot version-handshake logic (C2) lands; see
[docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2](../../docs/ARCHITECTURE_REFACTOR_PLAN.md#22-moves-mechanical-one-pr-behavior-preserving).
