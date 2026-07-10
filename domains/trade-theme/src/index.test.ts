import { describe, expect, it } from "vitest";
import { createTradeAliasVariables } from "./index";

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
