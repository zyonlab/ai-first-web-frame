# @mvp/trade-theme

`createTradeAliasVariables` — the trade domain's CSS variable-alias emitter
(contract D6): bridges the `--trade-*` vocabulary the SSR trade fragments read
onto the theme-aware `--mvp-color-*` tokens, and swaps the chrome typography
to the sans control stack.

Moved out of `packages/design-system/src/themes.ts` in the Phase P1
re-layering migration (§2.2 Move E); see
[docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2](../../docs/ARCHITECTURE_REFACTOR_PLAN.md#22-moves-mechanical-one-pr-behavior-preserving).
The generic theme/token system (`createBaseVariables`, `createThemeVariables`,
`createAllThemeVariables`, `TOKEN_PREFIX`) stays in `@mvp/design-system` —
this package depends on it.
