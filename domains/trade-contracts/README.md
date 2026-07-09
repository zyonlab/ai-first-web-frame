# @mvp/trade-contracts

Scaffolding package, not yet populated with real code. This is the future home
of the trade domain's interaction-bus contracts, mutations, and flows —
currently `packages/interaction/src/trade/*` (slices.ts, mutations.ts,
flows.ts) — once the Phase P1 re-layering migration moves domain code out of
the framework `@mvp/interaction` package and removes its
`export * from "./trade"` facade re-export; see
[docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2](../../docs/ARCHITECTURE_REFACTOR_PLAN.md#22-moves-mechanical-one-pr-behavior-preserving).
