import {
  emitDeclarations,
  type ThemeName,
  TOKEN_PREFIX,
} from "@mvp/design-system";

/**
 * Trade-terminal semantic bridge (contract D6).
 *
 * The SSR trade fragments (order book, order form, trades feed, positions,
 * open orders, portfolio summary) speak a `--trade-*` vocabulary with dark
 * hardcoded fallbacks. Nothing ever *defined* those variables, so every panel
 * resolved to its dark fallback regardless of `data-theme` — while the page
 * chrome followed the theme. That split is the visual "两层割裂".
 *
 * `buy`/`sell`/`up`/`down` are trade-domain colors (goal B3: `packages/**`
 * must contain zero domain code), so THIS package owns both their values and
 * their theme-scoped emission — it no longer aliases a design-system color.
 * {@link TRADE_SEMANTIC_COLORS} holds the light/dark values (byte-identical to
 * the values design-system used to own) and {@link createTradeColorVariables}
 * emits them via `@mvp/design-system`'s `emitDeclarations` (the same
 * mechanism `createThemeVariables` uses internally, now exported as a public
 * framework capability) into `:where([data-theme="light"])` /
 * `:where([data-theme="dark"])` blocks — so `--trade-buy` etc. resolve
 * per-theme exactly like `--mvp-color-*` did, without ever being defined
 * twice. The remaining, genuinely-derived `--trade-*` aliases (panel
 * chrome/typography) still point at the theme-aware `--mvp-color-*` tokens
 * from `@mvp/design-system`.
 *
 * `createTradeAliasVariables` is injected ONLY by the trade-demo pages, so it
 * doubles as the terminal's chrome-typography switch: overriding
 * `--mvp-font-body` to the sans control stack turns the storefront serif into
 * a terminal sans WITHOUT adding a second global `body{}` rule (keeps the
 * css-budget `globalSelectors` count flat).
 */

/** The trade demo's buy/sell/up/down semantic colors, per theme. */
export type TradeSemanticColors = {
  /** Buy / bid / long semantic color. */
  buy: string;
  /** Sell / ask / short semantic color. */
  sell: string;
  /** Positive change / uptick (mirrors buy). */
  up: string;
  /** Negative change / downtick (mirrors sell). */
  down: string;
};

/**
 * Light/dark values for the trade semantic colors — moved verbatim from
 * `packages/design-system/src/tokens.ts` (`lightColors`/`darkColors`
 * buy/sell/up/down keys); byte-identical hex values, only the ownership moved.
 */
export const TRADE_SEMANTIC_COLORS: Record<ThemeName, TradeSemanticColors> = {
  light: { buy: "#0f9d58", sell: "#d32f2f", up: "#0f9d58", down: "#d32f2f" },
  dark: { buy: "#22c55e", sell: "#ef4444", up: "#22c55e", down: "#ef4444" },
};

/**
 * Emits the trade semantic color variables (`--trade-buy`, `--trade-sell`,
 * `--trade-up`, `--trade-down`) for a single theme, scoped to
 * `:where([data-theme="<theme>"])` — the same pattern
 * `createThemeVariables` uses in `@mvp/design-system`. These are the ONLY
 * place `--trade-buy`/`--trade-sell`/`--trade-up`/`--trade-down` are defined;
 * `createTradeAliasVariables`'s `:where(:root)` block must never redefine
 * them (source order would then let the lower-specificity `:root` block lose
 * to nothing, or — worse — win over a block that should be theme-specific).
 */
export function createTradeColorVariables(theme: ThemeName): string {
  const lines = emitDeclarations("trade", "", TRADE_SEMANTIC_COLORS[theme]);
  return `:where([data-theme="${theme}"]){${lines.join("")}}`;
}

/**
 * The full trade-theme CSS the pages inject once: both theme-scoped color
 * blocks (light + dark) plus the `:where(:root)` block of derived aliases
 * (panel chrome, typography). Concatenated into a single string, matching how
 * `@mvp/design-system`'s `createAllThemeVariables` bundles its blocks — the
 * page layouts inject this as one `content` string (see `apps/page-trade`'s
 * `app/layout.tsx`).
 */
export function createTradeAliasVariables(
  prefix: string = TOKEN_PREFIX,
): string {
  const color = (key: string) => `var(--${prefix}-color-${key})`;
  const decls = [
    `--trade-panel-bg:${color("surface-1")}`,
    `--trade-panel-border:${color("border")}`,
    `--trade-text:${color("ink")}`,
    `--trade-text-muted:${color("text-muted")}`,
    `--trade-chip-active:${color("surface-2")}`,
    `--trade-row-hover:color-mix(in srgb, ${color("ink")} 6%, transparent)`,
    `--trade-flash-buy:color-mix(in srgb, var(--trade-buy) 26%, transparent)`,
    `--trade-flash-sell:color-mix(in srgb, var(--trade-sell) 26%, transparent)`,
    `--trade-font-mono:var(--${prefix}-font-mono)`,
    // Terminal chrome uses the sans control stack, not the storefront serif.
    `--${prefix}-font-body:var(--${prefix}-font-control)`,
  ];
  const rootBlock = `:where(:root){${decls.join(";")};}`;
  return (
    createTradeColorVariables("light") +
    createTradeColorVariables("dark") +
    rootBlock
  );
}
