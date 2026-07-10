# @mvp/islands

The framework's generic client-island runtime: the frozen mount markup +
snapshot contract (`registerIsland`, `mountIsland`, `hydrateIslands`,
`clearIslandRegistry`, `readIslandSnapshot`, `getIsland`). Domain-agnostic —
it knows nothing about `trade` or any other business domain; the components it
mounts are supplied by callers (fragments, page apps).

Moved here from `packages/trade-client/src/island.tsx` in the Phase P1
re-layering migration (§2.2 Move A); see
[docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2](../../docs/ARCHITECTURE_REFACTOR_PLAN.md#22-moves-mechanical-one-pr-behavior-preserving).
Per plan §4.3.1 this is also where the future snapshot version-handshake logic
(C2) lands.
