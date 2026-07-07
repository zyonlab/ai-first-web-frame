import { tailwindPreset } from "@mvp/design-system";
import type { Config } from "tailwindcss";

/**
 * Tailwind config for the `@mvp/ui` shadcn island primitives (doc 04 §2.2, §5.2).
 *
 * - `presets: [tailwindPreset]` pulls every color/spacing/radius/font/shadow/
 *   zIndex/screen utility from `@mvp/design-system`, each mapped to a
 *   `var(--mvp-*)` token variable (contract C1). This config defines NO palette
 *   of its own — the design-system preset is the single style source.
 * - `content` is scoped to the vendored primitive source only, so Tailwind
 *   purges to the token utilities actually used. SSR fragment CSS is never run
 *   through Tailwind, keeping fragment CSS budgets clean.
 * - Preflight/base is disabled: the reset lives once in `@mvp/design-system`
 *   (`baseResetCss`), shipped by the shell, so utilities do not duplicate it
 *   across units (doc 04 §5.2 / §5.3).
 */
const config: Config = {
  presets: [tailwindPreset as unknown as Partial<Config>],
  content: ["./src/**/*.{ts,tsx}"],
  corePlugins: {
    // Reset lives once in @mvp/design-system; do not re-emit Preflight here.
    preflight: false,
  },
};

export default config;
