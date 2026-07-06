import {
  baseScales,
  lightColors,
  type ThemeName,
  TOKEN_PREFIX,
} from "./tokens";

/**
 * Tailwind preset (contract C1 / doc 04 §2.2).
 *
 * This is a **pure JS configuration object** — no `tailwindcss` import, no
 * runtime. Island packages consume it via:
 *
 * ```ts
 * // packages/trade-client/tailwind.config.ts  (build-time only)
 * import { tailwindPreset } from "@mvp/design-system";
 * export default {
 *   presets: [tailwindPreset],
 *   content: ["./src/**\/*.{ts,tsx}"], // island source only; SSR CSS is not purged
 * };
 * ```
 *
 * Every utility resolves to a `var(--mvp-*)` token variable — never a literal
 * hex — so a token/theme flip recolors Tailwind utilities and SSR token CSS
 * together from one `data-theme` attribute change, with zero JS.
 *
 * `darkMode` is `["selector", '[data-theme="dark"]']` because `@mvp/assets`
 * theme tags emit `data-theme` (not a `.dark` class); this carries the theme
 * name and matches the SSR no-flash first paint (doc 04 §2.3, doc 05 §4).
 *
 * The color/spacing/font/zIndex maps are **generated** from the token structure
 * so a new token key does not require a matching preset edit.
 */

function toVar(group: string, key: string): string {
  return `var(--${TOKEN_PREFIX}-${group}-${key})`;
}

/** Map every key of a token group to its `var(--mvp-<group>-<key>)` string. */
function mapGroupToVars(group: string, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    out[key] = toVar(group, key);
  }
  return out;
}

// Color utilities use the semantic color key set (identical in both themes,
// contract C9); the value is a var() so the theme block supplies the concrete
// color at runtime.
const colorVars = mapGroupToVars("color", Object.keys(lightColors));

// Spacing doubles as the width/height scale; add the trade grid track widths so
// `w-book` / `w-rail` / `w-form` are available alongside `p-md` etc.
const spacingVars = {
  ...mapGroupToVars("spacing", Object.keys(baseScales.spacing)),
  ...mapGroupToVars("grid", Object.keys(baseScales.grid)),
};

const fontFamilyVars = mapGroupToVars("font", Object.keys(baseScales.font));
const radiusVars = mapGroupToVars("radius", Object.keys(baseScales.radius));
const shadowVars = mapGroupToVars("shadow", Object.keys(baseScales.shadow));

// zIndex utilities keep their numeric values (Tailwind expects string numbers
// for the z-index scale); mirrors the token zIndex scale incl. D6 `sticky`.
const zIndexVars: Record<string, string> = {};
for (const [key, value] of Object.entries(baseScales.zIndex)) {
  zIndexVars[key] = String(value);
}

// Screens come from the token breakpoints so responsive variants match tokens.
const screenVars = { ...baseScales.breakpoint } as Record<string, string>;

export const DARK_MODE_SELECTOR = '[data-theme="dark"]';

export const tailwindPreset = {
  darkMode: ["selector", DARK_MODE_SELECTOR] as [
    ThemeName | "selector",
    string,
  ],
  theme: {
    extend: {
      colors: colorVars,
      spacing: spacingVars,
      fontFamily: fontFamilyVars,
      borderRadius: radiusVars,
      boxShadow: shadowVars,
      zIndex: zIndexVars,
      screens: screenVars,
    },
  },
} as const;

export type TailwindPreset = typeof tailwindPreset;
