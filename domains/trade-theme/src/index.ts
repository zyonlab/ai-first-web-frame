import { TOKEN_PREFIX } from "@mvp/design-system";

/**
 * Trade-terminal semantic bridge (contract D6).
 *
 * The SSR trade fragments (order book, order form, trades feed, positions,
 * open orders, portfolio summary) speak a `--trade-*` vocabulary with dark
 * hardcoded fallbacks. Nothing ever *defined* those variables, so every panel
 * resolved to its dark fallback regardless of `data-theme` — while the page
 * chrome and the `--mvp-color-*`-driven fragments followed the theme. That split
 * is the visual "两层割裂".
 *
 * This emitter defines the missing bridge: each `--trade-*` alias points at the
 * theme-aware `--mvp-color-*` token (from `@mvp/design-system`), so the
 * fragments follow the active `data-theme` for free (the right-hand values are
 * already per-theme). Emitted under `:where(:root)` (specificity 0) so consumer
 * rules still win.
 *
 * It is injected ONLY by the trade-demo pages, so it doubles as the terminal's
 * chrome-typography switch: overriding `--mvp-font-body` to the sans control
 * stack turns the storefront serif into a terminal sans WITHOUT adding a second
 * global `body{}` rule (keeps the css-budget `globalSelectors` count flat).
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
    `--trade-buy:${color("buy")}`,
    `--trade-sell:${color("sell")}`,
    `--trade-chip-active:${color("surface-2")}`,
    `--trade-row-hover:color-mix(in srgb, ${color("ink")} 6%, transparent)`,
    `--trade-flash-buy:color-mix(in srgb, ${color("buy")} 26%, transparent)`,
    `--trade-flash-sell:color-mix(in srgb, ${color("sell")} 26%, transparent)`,
    `--trade-font-mono:var(--${prefix}-font-mono)`,
    // Terminal chrome uses the sans control stack, not the storefront serif.
    `--${prefix}-font-body:var(--${prefix}-font-control)`,
  ];
  return `:where(:root){${decls.join(";")};}`;
}
