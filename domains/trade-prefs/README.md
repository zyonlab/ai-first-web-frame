# @mvp/trade-prefs

The trade domain's user-preference APIs: watchlist (`createWatchlist`),
recent symbols (`createRecentSymbols`), layout prefs (`createLayoutPrefs`),
and the site-wide theme (`readThemePreference` / `writeThemePreference`) and
locale (`resolveLocalePreference` / `writeLocalePreference`) cookie prefs used
by the trade demo's pages (`page-markets`, `page-portfolio`, `page-referrals`,
`page-trade`, `page-vaults`) and `shell-gateway`.

Moved out of `packages/storage/src/prefs/*` in the Phase P1 re-layering
migration (§2.2 Move D); see
[docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2](../../docs/ARCHITECTURE_REFACTOR_PLAN.md#22-moves-mechanical-one-pr-behavior-preserving).
The generic storage primitives (`createStorage`, policy validation, storage
adapters) stay in `@mvp/storage` — this package depends on it.
