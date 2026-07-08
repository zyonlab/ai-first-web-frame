import {
  baseScales,
  type ThemeName,
  TOKEN_PREFIX,
  themeColors,
} from "./tokens";

/**
 * CSS variable emitters (contract C9).
 *
 * Two flavours:
 * - {@link createBaseVariables} emits the theme-invariant scales once, under
 *   `:where(:root)`. These never change with the theme.
 * - {@link createThemeVariables} emits the per-theme semantic colors under a
 *   `:where([data-theme="<theme>"])` block. `@mvp/assets` sets `data-theme` on
 *   the root element (its ThemeAsset tags emit `data-theme="<name>"`), so a
 *   theme switch is a pure attribute flip — both light and dark blocks ship and
 *   the matching one wins with zero JS.
 *
 * The `:where(...)` wrapper keeps specificity at 0 so consumer styles and
 * Tailwind utilities always override, matching `@mvp/design-tokens`.
 */

function emitDeclarations(
  prefix: string,
  group: string,
  values: Readonly<Record<string, string | number>>,
): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    lines.push(`--${prefix}-${group}-${key}: ${value};`);
  }
  return lines;
}

/**
 * Emit the theme-invariant scale variables (spacing, radius, font, breakpoint,
 * shadow, zIndex, grid) once under `:where(:root)`.
 */
export function createBaseVariables(prefix: string = TOKEN_PREFIX): string {
  const lines: string[] = [];
  for (const [group, values] of Object.entries(baseScales)) {
    lines.push(...emitDeclarations(prefix, group, values));
  }
  return `:where(:root){${lines.join("")}}`;
}

/**
 * Emit the semantic color variables for a single theme, scoped to
 * `:where([data-theme="<theme>"])`. Values differ between `light` and `dark`
 * while the variable *names* stay identical (contract C9).
 */
export function createThemeVariables(
  theme: ThemeName,
  prefix: string = TOKEN_PREFIX,
): string {
  const colors = themeColors[theme];
  const lines = emitDeclarations(prefix, "color", colors);
  return `:where([data-theme="${theme}"]){${lines.join("")}}`;
}

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
 * theme-aware `--mvp-color-*` token, so the fragments follow the active
 * `data-theme` for free (the right-hand values are already per-theme). Emitted
 * under `:where(:root)` (specificity 0) so consumer rules still win.
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

/**
 * Convenience: the full theme CSS block — base scales plus both theme color
 * sets — as a single string the shell can inject once. `light` is also mapped
 * onto bare `:where(:root)` so a page with no `data-theme` attribute still
 * paints the light theme.
 */
export function createAllThemeVariables(prefix: string = TOKEN_PREFIX): string {
  const rootLight = emitDeclarations(prefix, "color", themeColors.light);
  return [
    createBaseVariables(prefix),
    // Default (attribute-less) paint = light.
    `:where(:root){${rootLight.join("")}}`,
    createThemeVariables("light", prefix),
    createThemeVariables("dark", prefix),
  ].join("");
}
