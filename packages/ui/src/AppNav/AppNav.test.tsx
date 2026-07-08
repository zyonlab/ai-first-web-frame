import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppNav, appNavCss, primaryNavLinks } from "./index";

/** Render the nav to a static HTML string (SSR posture) for assertions. */
function html(...args: Parameters<typeof AppNav>): string {
  return renderToStaticMarkup(<AppNav {...args[0]} />);
}

describe("@mvp/ui AppNav", () => {
  it("renders the brand + all primary nav links as plain anchors", () => {
    const out = html({ currentPath: "/markets", theme: "light", locale: "en" });
    expect(out).toContain("MVP Perps");
    expect(out).toContain('href="/trade/BTC"');
    expect(out).toContain('href="/markets"');
    expect(out).toContain('href="/portfolio"');
    expect(out).toContain('href="/vaults"');
    expect(out).toContain('href="/referrals"');
    expect(out).toContain('data-shell-nav="true"');
  });

  it("marks the active route with aria-current=page", () => {
    const out = html({ currentPath: "/markets", theme: "light", locale: "en" });
    expect(out).toMatch(/href="\/markets"[^>]*aria-current="page"/);
    // Trade is not current on /markets.
    expect(out).not.toMatch(/href="\/trade\/BTC"[^>]*aria-current="page"/);
  });

  it("treats /trade/:symbol as the active Trade route", () => {
    const out = html({
      currentPath: "/trade/ETH",
      theme: "dark",
      locale: "en",
    });
    expect(out).toMatch(
      /class="mvp-shell-navlink mvp-shell-navlink--active"[^>]*href="\/trade\/BTC"/,
    );
    expect(out).toMatch(/href="\/trade\/BTC"[^>]*aria-current="page"/);
  });

  it("does not mark any nav link active on a non-nav route", () => {
    const out = html({
      currentPath: "/product/1",
      theme: "light",
      locale: "en",
    });
    expect(out).not.toMatch(/mvp-shell-navlink[^>]*aria-current="page"/);
  });

  it("deep-links Trade to the last-viewed symbol when supplied", () => {
    expect(primaryNavLinks("eth").find((l) => l.id === "trade")?.href).toBe(
      "/trade/ETH",
    );
    const out = html({
      currentPath: "/markets",
      theme: "light",
      locale: "en",
      lastSymbol: "sol",
    });
    expect(out).toContain('href="/trade/SOL"');
  });

  it("renders no-JS theme + locale switch links to the shell endpoints", () => {
    const out = html({
      currentPath: "/portfolio",
      theme: "light",
      locale: "en",
    });
    // Theme cycles light -> dark; returnTo is the current path.
    expect(out).toContain("/_shell/theme?value=dark");
    expect(out).toContain("returnTo=%2Fportfolio");
    // Locale toggles en -> zh.
    expect(out).toContain("/_shell/locale?value=zh");
    expect(out).toMatch(/data-shell-control="theme"/);
    expect(out).toMatch(/data-shell-control="locale"/);
  });

  it("cycles the theme label dark -> system", () => {
    const out = html({ currentPath: "/", theme: "dark", locale: "zh" });
    expect(out).toContain("/_shell/theme?value=system");
    // Locale toggles zh -> en.
    expect(out).toContain("/_shell/locale?value=en");
  });

  it("mounts into a DOM tree with a Primary landmark", () => {
    const { getByLabelText } = render(
      <AppNav currentPath="/vaults" theme="system" locale="en" />,
    );
    expect(getByLabelText("Primary")).toBeTruthy();
  });

  it("appNavCss reads only design-system --mvp-* tokens (no hard-coded colors)", () => {
    const css = appNavCss();
    expect(css).toContain(".mvp-shell-nav");
    expect(css).toContain("var(--mvp-color-surface-1)");
    expect(css).toContain("var(--mvp-color-accent)");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
