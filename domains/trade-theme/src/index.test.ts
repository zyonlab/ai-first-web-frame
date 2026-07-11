import { describe, expect, it } from "vitest";
import {
  createTradeAliasVariables,
  createTradeColorVariables,
  TRADE_SEMANTIC_COLORS,
} from "./index";

describe("createTradeColorVariables (trade-owned semantic colors, B3)", () => {
  it("emits the light theme's buy/sell/up/down with the exact preserved hex values", () => {
    const css = createTradeColorVariables("light");
    expect(css.startsWith(':where([data-theme="light"]){')).toBe(true);
    expect(css).toContain("--trade-buy: #0f9d58;");
    expect(css).toContain("--trade-sell: #d32f2f;");
    expect(css).toContain("--trade-up: #0f9d58;");
    expect(css).toContain("--trade-down: #d32f2f;");
  });

  it("emits the dark theme's buy/sell/up/down with the exact preserved hex values", () => {
    const css = createTradeColorVariables("dark");
    expect(css.startsWith(':where([data-theme="dark"]){')).toBe(true);
    expect(css).toContain("--trade-buy: #22c55e;");
    expect(css).toContain("--trade-sell: #ef4444;");
    expect(css).toContain("--trade-up: #22c55e;");
    expect(css).toContain("--trade-down: #ef4444;");
  });

  it("light and dark values differ (theme-aware, not a shared fallback)", () => {
    // Regression guard for the exact bug this D6 bridge exists to fix: before
    // it, every trade panel resolved to a hardcoded fallback regardless of
    // `data-theme`. Same shape here — light/dark must genuinely diverge.
    expect(TRADE_SEMANTIC_COLORS.light.buy).not.toBe(
      TRADE_SEMANTIC_COLORS.dark.buy,
    );
    expect(TRADE_SEMANTIC_COLORS.light.sell).not.toBe(
      TRADE_SEMANTIC_COLORS.dark.sell,
    );
    expect(TRADE_SEMANTIC_COLORS.light.up).not.toBe(
      TRADE_SEMANTIC_COLORS.dark.up,
    );
    expect(TRADE_SEMANTIC_COLORS.light.down).not.toBe(
      TRADE_SEMANTIC_COLORS.dark.down,
    );
  });
});

describe("D6 trade-terminal token bridge (createTradeAliasVariables)", () => {
  const css = createTradeAliasVariables();

  it("bundles both theme-scoped color blocks plus the :root alias block", () => {
    expect(css).toContain(':where([data-theme="light"]){');
    expect(css).toContain(':where([data-theme="dark"]){');
    expect(css).toContain(":where(:root){");
  });

  it("defines --trade-buy/sell/up/down ONLY inside the theme-scoped blocks, never in :where(:root)", () => {
    // The regression this guards against: re-defining --trade-buy in the
    // :root block alongside the theme-scoped blocks would create two sources
    // of truth for the same variable — whichever a browser resolves last
    // could silently win, reintroducing the "colors don't follow data-theme"
    // bug this module exists to fix.
    const rootBlock = css.slice(css.lastIndexOf(":where(:root){"));
    expect(rootBlock).not.toContain("--trade-buy:");
    expect(rootBlock).not.toContain("--trade-sell:");
    expect(rootBlock).not.toContain("--trade-up:");
    expect(rootBlock).not.toContain("--trade-down:");
  });

  it("maps every consumed --trade-* chrome/typography alias onto a theme-aware --mvp-color-* token", () => {
    const aliasToToken: Record<string, string> = {
      "--trade-panel-bg": "--mvp-color-surface-1",
      "--trade-panel-border": "--mvp-color-border",
      "--trade-text": "--mvp-color-ink",
      "--trade-text-muted": "--mvp-color-text-muted",
      "--trade-chip-active": "--mvp-color-surface-2",
      "--trade-row-hover": "--mvp-color-ink",
      "--trade-font-mono": "--mvp-font-mono",
    };
    for (const [alias, token] of Object.entries(aliasToToken)) {
      expect(css).toContain(`${alias}:`);
      expect(css).toContain(token);
    }
  });

  it("derives --trade-flash-buy/sell from the trade-owned --trade-buy/--trade-sell variables, not --mvp-color-*", () => {
    expect(css).toContain(
      "--trade-flash-buy:color-mix(in srgb, var(--trade-buy) 26%, transparent)",
    );
    expect(css).toContain(
      "--trade-flash-sell:color-mix(in srgb, var(--trade-sell) 26%, transparent)",
    );
    expect(css).not.toContain("var(--mvp-color-buy)");
    expect(css).not.toContain("var(--mvp-color-sell)");
  });

  it("swaps the storefront serif body font to the sans control stack", () => {
    expect(css).toContain("--mvp-font-body:var(--mvp-font-control)");
  });

  it("carries no hardcoded hex colors outside the trade-owned semantic color blocks", () => {
    const rootBlock = css.slice(css.lastIndexOf(":where(:root){"));
    expect(rootBlock).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
