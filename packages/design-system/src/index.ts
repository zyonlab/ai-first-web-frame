/**
 * `@mvp/design-system` — the single source of truth for the trade demo's
 * design tokens, themes, base reset, and Tailwind preset (spine §11, doc 04,
 * doc 05; slot A0-design).
 *
 * Contracts frozen here:
 * - C1 (design tokens): `cssVariableNames` — the stable `--mvp-*` variable-name
 *   list every consumer must read from; `tailwindPreset` maps utilities onto
 *   the same variables.
 * - C9 (theme token sets): `createThemeVariables("light"|"dark")` emits the two
 *   `:where([data-theme="..."])` color blocks over identical variable names.
 */

export { baseResetCss } from "./reset";
export {
  DARK_MODE_SELECTOR,
  type TailwindPreset,
  tailwindPreset,
} from "./tailwindPreset";
export {
  createAllThemeVariables,
  createBaseVariables,
  createThemeVariables,
  createTradeAliasVariables,
} from "./themes";
export {
  baseScales,
  cssVariableNames,
  darkColors,
  lightColors,
  type SemanticColors,
  type ThemeName,
  TOKEN_PREFIX,
  themeColors,
  tokens,
} from "./tokens";
