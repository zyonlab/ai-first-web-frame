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

/**
 * Emits `--<prefix>-<group>-<key>: <value>;` declaration lines for a record of
 * token values — the generic primitive `createBaseVariables` /
 * `createThemeVariables` build on internally. Exported (public API) so a
 * domain package outside this framework package can define its OWN
 * theme-scoped CSS custom properties using the exact same emission mechanism
 * design-system uses for its semantic colors, without reinventing CSS-string
 * building. Pass `group: ""` for a flat `--<prefix>-<key>` name (no middle
 * segment) — e.g. `emitDeclarations("trade", "", { buy: "#0f9d58" })` emits
 * `--trade-buy: #0f9d58;`.
 */
export function emitDeclarations(
  prefix: string,
  group: string,
  values: Readonly<Record<string, string | number>>,
): string[] {
  const infix = group ? `-${group}` : "";
  const lines: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    lines.push(`--${prefix}${infix}-${key}: ${value};`);
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
