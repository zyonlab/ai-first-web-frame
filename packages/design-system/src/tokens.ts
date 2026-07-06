import { tokens as baseTokens } from "@mvp/design-tokens";

/**
 * Design-system tokens for the trade demo.
 *
 * This package is the single source of truth (contract C1) for every CSS
 * variable name consumed by SSR fragments, Tailwind islands, and shadcn
 * primitives. It layers the D6 trade tokens on top of `@mvp/design-tokens`:
 *
 * - theme-invariant scales (spacing, radius, font, breakpoint, shadow, zIndex,
 *   trade grid track widths) that never change between light and dark, and
 * - theme-variant semantic colors (surfaces, text, border, buy/sell, up/down)
 *   whose *names* are stable but whose *values* differ per theme (contract C9).
 *
 * Variable naming is inherited from `@mvp/design-tokens.createCssVariables`:
 * `--<prefix>-<group>-<key>` with the default prefix `mvp`, e.g.
 * `--mvp-color-buy`, `--mvp-spacing-md`, `--mvp-grid-book`.
 */

export const TOKEN_PREFIX = "mvp" as const;

/**
 * Theme-invariant token scales. These are re-exported/extended from the base
 * `@mvp/design-tokens` object; their values are identical in every theme, so
 * they live in the base `:where(:root)` variable block, not the theme blocks.
 *
 * D6 additions vs. the base tokens:
 * - `grid`     — trade-page grid track widths (order book / side rail columns).
 * - `font.mono`— tabular/monospace family for numeric price columns
 *                (emitted as `--mvp-font-mono`).
 * - `zIndex.sticky` — the base set only had base/overlay/modal; sticky panel
 *                headers (order book header, positions table header) sit between
 *                base and overlay.
 */
export const baseScales = {
  spacing: baseTokens.spacing,
  radius: baseTokens.radius,
  font: {
    ...baseTokens.font,
    // Tabular monospace numerals for price/size columns (D6 --mvp-font-mono).
    mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  },
  breakpoint: baseTokens.breakpoint,
  shadow: baseTokens.shadow,
  // D6: add `sticky` between `base` and `overlay` for sticky panel chrome.
  zIndex: {
    base: baseTokens.zIndex.base,
    sticky: 10,
    overlay: baseTokens.zIndex.overlay,
    modal: baseTokens.zIndex.modal,
  },
  // D6: trade-page grid track widths (order book ladder + side rail widths).
  // Consumed by the trade layout grid and the Tailwind `spacing`/`width` scale.
  grid: {
    book: "320px",
    rail: "280px",
    form: "300px",
  },
} as const;

/**
 * Theme-variant semantic colors. Same keys in both themes (contract C9); only
 * the values differ. `buy`/`sell` are the D6 trading semantic colors; up/down
 * mirror them for non-order contexts (24h change, PnL). `accent`/`signal`/
 * `muted` carry the base palette forward but are theme-aware here.
 */
export type SemanticColors = {
  /** Page/background base surface (deepest layer). */
  "surface-0": string;
  /** Raised panel surface. */
  "surface-1": string;
  /** Overlay / popover surface. */
  "surface-2": string;
  /** Primary foreground text. */
  ink: string;
  /** Muted / secondary text. */
  "text-muted": string;
  /** Hairline / panel border. */
  border: string;
  /** Brand accent. */
  accent: string;
  /** Attention / warning signal. */
  signal: string;
  /** Legacy muted color (kept for base-token parity). */
  muted: string;
  /** D6 buy / bid / long semantic color. */
  buy: string;
  /** D6 sell / ask / short semantic color. */
  sell: string;
  /** Positive change / uptick (mirrors buy). */
  up: string;
  /** Negative change / downtick (mirrors sell). */
  down: string;
};

/** Light theme semantic color values. */
export const lightColors: SemanticColors = {
  "surface-0": "#fbfaf7",
  "surface-1": "#ffffff",
  "surface-2": "#f2f0ea",
  ink: "#15171a",
  "text-muted": "#69707a",
  border: "#e2ddd2",
  accent: "#0f766e",
  signal: "#d97706",
  muted: "#69707a",
  buy: "#0f9d58",
  sell: "#d32f2f",
  up: "#0f9d58",
  down: "#d32f2f",
};

/** Dark theme semantic color values. */
export const darkColors: SemanticColors = {
  "surface-0": "#0e1013",
  "surface-1": "#16191e",
  "surface-2": "#1e232a",
  ink: "#f4f5f7",
  "text-muted": "#9aa2ad",
  border: "#2a2f37",
  accent: "#2dd4bf",
  signal: "#f59e0b",
  muted: "#9aa2ad",
  buy: "#22c55e",
  sell: "#ef4444",
  up: "#22c55e",
  down: "#ef4444",
};

export type ThemeName = "light" | "dark";

/** Per-theme semantic color lookup (contract C9). */
export const themeColors: Record<ThemeName, SemanticColors> = {
  light: lightColors,
  dark: darkColors,
};

/**
 * The full token surface exported to consumers: theme-invariant scales plus the
 * default (light) color set, so `tokens.color.buy` resolves to a concrete value
 * while `themeColors` / `createThemeVariables` provide the per-theme override.
 */
export const tokens = {
  color: lightColors,
  ...baseScales,
} as const;

/**
 * Frozen contract C1 — the stable list of CSS variable names other agents may
 * read. Any consumer (A0-ui, A0-client, fragment agents) must only reference
 * names in this set; adding a token means adding it here first.
 *
 * Built deterministically from `baseScales` + the semantic color keys so it can
 * never drift from what `createCssVariables` / `createThemeVariables` emit.
 */
function collectVariableNames(prefix: string): string[] {
  const names: string[] = [];
  // Theme-variant color variables (values live in the theme blocks).
  for (const key of Object.keys(lightColors)) {
    names.push(`--${prefix}-color-${key}`);
  }
  // Theme-invariant scale variables (values live in the base :root block).
  for (const [group, values] of Object.entries(baseScales)) {
    for (const key of Object.keys(values)) {
      names.push(`--${prefix}-${group}-${key}`);
    }
  }
  return names;
}

/**
 * Frozen C1 variable-name list for the default prefix (`--mvp-*`). Ordered
 * colors-first, then scales, so downstream snapshot tests are stable.
 */
export const cssVariableNames: readonly string[] = Object.freeze(
  collectVariableNames(TOKEN_PREFIX),
);
