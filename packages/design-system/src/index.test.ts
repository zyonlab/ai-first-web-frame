import { describe, expect, it } from "vitest";
import {
  baseResetCss,
  createAllThemeVariables,
  createBaseVariables,
  createThemeVariables,
  createTradeAliasVariables,
  cssVariableNames,
  darkColors,
  lightColors,
  tailwindPreset,
  themeColors,
  tokens,
} from "./index";

describe("tokens (D6 additions)", () => {
  it("exposes trade grid track widths", () => {
    expect(tokens.grid.book).toBe("320px");
    expect(tokens.grid.rail).toBeTruthy();
    expect(tokens.grid.form).toBeTruthy();
  });

  it("adds a monospace font family for numeric columns", () => {
    expect(tokens.font.mono).toMatch(/mono/i);
    // Base body/control families are carried forward from @mvp/design-tokens.
    expect(tokens.font.body).toBeTruthy();
    expect(tokens.font.control).toBeTruthy();
  });

  it("adds zIndex.sticky between base and overlay", () => {
    expect(tokens.zIndex.base).toBe(0);
    expect(tokens.zIndex.sticky).toBeGreaterThan(tokens.zIndex.base);
    expect(tokens.zIndex.sticky).toBeLessThan(tokens.zIndex.overlay);
    expect(tokens.zIndex.overlay).toBeLessThan(tokens.zIndex.modal);
  });

  it("defines buy/sell semantic colors (default = light)", () => {
    expect(tokens.color.buy).toBeTruthy();
    expect(tokens.color.sell).toBeTruthy();
    expect(tokens.color.buy).not.toBe(tokens.color.sell);
    expect(tokens.color.buy).toBe(lightColors.buy);
  });
});

describe("C1 frozen CSS variable names", () => {
  it("includes the D6 trade tokens and semantic colors", () => {
    expect(cssVariableNames).toContain("--mvp-color-buy");
    expect(cssVariableNames).toContain("--mvp-color-sell");
    expect(cssVariableNames).toContain("--mvp-color-surface-0");
    expect(cssVariableNames).toContain("--mvp-color-border");
    expect(cssVariableNames).toContain("--mvp-color-text-muted");
    expect(cssVariableNames).toContain("--mvp-font-mono");
    expect(cssVariableNames).toContain("--mvp-zIndex-sticky");
    expect(cssVariableNames).toContain("--mvp-grid-book");
  });

  it("is frozen and free of duplicates", () => {
    expect(Object.isFrozen(cssVariableNames)).toBe(true);
    expect(new Set(cssVariableNames).size).toBe(cssVariableNames.length);
  });

  it("every emitted variable name is declared in C1", () => {
    const emitted = createAllThemeVariables();
    for (const name of cssVariableNames) {
      expect(emitted).toContain(`${name}:`);
    }
  });

  it("every name follows the --mvp-<group>-<key> convention", () => {
    for (const name of cssVariableNames) {
      expect(name).toMatch(/^--mvp-[a-zA-Z]+-[a-zA-Z0-9-]+$/);
    }
  });
});

describe("C9 light/dark theme variables", () => {
  it("emits a data-theme scoped block per theme", () => {
    expect(createThemeVariables("light")).toContain(
      ':where([data-theme="light"])',
    );
    expect(createThemeVariables("dark")).toContain(
      ':where([data-theme="dark"])',
    );
  });

  it("uses data-theme attribute (not a .dark class)", () => {
    const dark = createThemeVariables("dark");
    expect(dark).toContain("data-theme");
    expect(dark).not.toMatch(/\.dark\b/);
  });

  it("defines the same color variable names in both themes", () => {
    const lightKeys = Object.keys(lightColors).sort();
    const darkKeys = Object.keys(darkColors).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  it("light values differ from dark values", () => {
    const light = createThemeVariables("light");
    const dark = createThemeVariables("dark");
    expect(light).not.toEqual(dark);
    // Spot-check that semantic colors actually diverge.
    expect(themeColors.light["surface-0"]).not.toBe(
      themeColors.dark["surface-0"],
    );
    expect(themeColors.light.buy).not.toBe(themeColors.dark.buy);
    expect(themeColors.light.ink).not.toBe(themeColors.dark.ink);
  });

  it("defines buy/sell (and up/down) in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      const block = createThemeVariables(theme);
      expect(block).toContain("--mvp-color-buy:");
      expect(block).toContain("--mvp-color-sell:");
      expect(block).toContain("--mvp-color-up:");
      expect(block).toContain("--mvp-color-down:");
      expect(block).toContain("--mvp-color-border:");
      expect(block).toContain("--mvp-color-surface-0:");
    }
  });

  it("base variables carry the theme-invariant scales at :root", () => {
    const base = createBaseVariables();
    expect(base).toContain(":where(:root)");
    expect(base).toContain("--mvp-spacing-md:");
    expect(base).toContain("--mvp-font-mono:");
    expect(base).toContain("--mvp-zIndex-sticky:");
    expect(base).toContain("--mvp-grid-book:");
    // Colors are theme-variant, so they do NOT live in the base block.
    expect(base).not.toContain("--mvp-color-buy:");
  });

  it("createAllThemeVariables bundles base + light default + both themes", () => {
    const all = createAllThemeVariables();
    expect(all).toContain(":where(:root)");
    expect(all).toContain(':where([data-theme="light"])');
    expect(all).toContain(':where([data-theme="dark"])');
    expect(all).toContain("--mvp-color-buy:");
  });
});

describe("D6 trade-terminal token bridge", () => {
  it("maps every consumed --trade-* alias onto a theme-aware --mvp-color-* token", () => {
    const css = createTradeAliasVariables();
    // Structural: scoped at specificity 0 so fragment rules still win.
    expect(css.startsWith(":where(:root){")).toBe(true);
    // Each --trade-* name the SSR fragments read must be defined here, and its
    // value must reference an --mvp-color-* token (so it follows data-theme)
    // rather than a hardcoded color.
    const aliasToToken: Record<string, string> = {
      "--trade-panel-bg": "--mvp-color-surface-1",
      "--trade-panel-border": "--mvp-color-border",
      "--trade-text": "--mvp-color-ink",
      "--trade-text-muted": "--mvp-color-text-muted",
      "--trade-buy": "--mvp-color-buy",
      "--trade-sell": "--mvp-color-sell",
      "--trade-chip-active": "--mvp-color-surface-2",
      "--trade-row-hover": "--mvp-color-ink",
      "--trade-flash-buy": "--mvp-color-buy",
      "--trade-flash-sell": "--mvp-color-sell",
      "--trade-font-mono": "--mvp-font-mono",
    };
    for (const [alias, token] of Object.entries(aliasToToken)) {
      expect(css).toContain(`${alias}:`);
      expect(css).toContain(token);
    }
  });

  it("swaps the storefront serif body font to the sans control stack", () => {
    // Terminal chrome: only trade pages inject this block, so re-pointing
    // --mvp-font-body at --mvp-font-control turns the serif into sans without a
    // second global body{} rule.
    expect(createTradeAliasVariables()).toContain(
      "--mvp-font-body:var(--mvp-font-control)",
    );
  });

  it("carries no hardcoded hex colors (values come from tokens only)", () => {
    expect(createTradeAliasVariables()).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

describe("base reset CSS", () => {
  it("is a non-empty string", () => {
    expect(typeof baseResetCss).toBe("string");
    expect(baseResetCss.length).toBeGreaterThan(0);
  });

  it("includes a box-sizing reset and reads token variables", () => {
    expect(baseResetCss).toContain("box-sizing:border-box");
    expect(baseResetCss).toContain("var(--mvp-color-ink");
    expect(baseResetCss).toContain("var(--mvp-color-surface-0");
    expect(baseResetCss).toContain("var(--mvp-font-mono");
  });
});

describe("Tailwind preset", () => {
  it("uses data-theme dark mode selector, not a class", () => {
    expect(tailwindPreset.darkMode).toEqual([
      "selector",
      '[data-theme="dark"]',
    ]);
  });

  it("maps colors/spacing/fontFamily to var(--mvp-*)", () => {
    const { colors, spacing, fontFamily } = tailwindPreset.theme.extend;
    expect(colors.buy).toBe("var(--mvp-color-buy)");
    expect(colors.sell).toBe("var(--mvp-color-sell)");
    expect(colors["surface-0"]).toBe("var(--mvp-color-surface-0)");
    expect(spacing.md).toBe("var(--mvp-spacing-md)");
    expect(spacing.book).toBe("var(--mvp-grid-book)");
    expect(fontFamily.mono).toBe("var(--mvp-font-mono)");
  });

  it("carries the zIndex scale incl. sticky and token screens", () => {
    expect(tailwindPreset.theme.extend.zIndex.sticky).toBe("10");
    expect(tailwindPreset.theme.extend.screens.md).toBe("768px");
  });

  it("every color/spacing/font utility resolves to a C1 variable name", () => {
    const groups = [
      tailwindPreset.theme.extend.colors,
      tailwindPreset.theme.extend.spacing,
      tailwindPreset.theme.extend.fontFamily,
    ];
    for (const group of groups) {
      for (const value of Object.values(group)) {
        const match = /^var\((--mvp-[a-zA-Z0-9-]+)\)$/.exec(value);
        expect(match, `expected var() mapping, got ${value}`).not.toBeNull();
        expect(cssVariableNames).toContain(match?.[1]);
      }
    }
  });

  it("does not import tailwindcss (pure JS object)", () => {
    // A plain object with only these keys — no runtime, no Config instance.
    expect(Object.keys(tailwindPreset).sort()).toEqual(["darkMode", "theme"]);
  });
});
