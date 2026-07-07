import { createAllThemeVariables } from "@mvp/design-system";
import { describe, expect, it } from "vitest";
import {
  localeToLang,
  primaryNavLinks,
  renderShellNav,
  renderThemeHead,
  wrapShellChrome,
} from "../src/chrome";

describe("shell chrome — theme head", () => {
  it("injects the design-system base + light + dark theme variables once", () => {
    const head = renderThemeHead();
    // Base scale + both theme color blocks from the frozen design-system emitter.
    expect(head).toContain(createAllThemeVariables());
    expect(head).toContain(':where([data-theme="light"])');
    expect(head).toContain(':where([data-theme="dark"])');
    // Semantic color variables are present (no hard-coded colors in nav CSS).
    expect(head).toContain("--mvp-color-surface-1");
    expect(head).toContain("--mvp-color-accent");
  });

  it("resolves the `system` theme via CSS media queries only (no script)", () => {
    const head = renderThemeHead();
    expect(head).toContain("@media (prefers-color-scheme:dark)");
    expect(head).toContain("@media (prefers-color-scheme:light)");
    expect(head).toContain(':where([data-theme="system"])');
    expect(head).not.toContain("<script");
  });

  it("carries the CSP nonce on every injected style tag", () => {
    const head = renderThemeHead("head-nonce");
    const nonced = head.match(/nonce="head-nonce"/g) ?? [];
    expect(nonced.length).toBeGreaterThanOrEqual(3);
  });
});

describe("shell chrome — navigation", () => {
  it("renders brand + all primary nav links as plain anchors", () => {
    const nav = renderShellNav({
      pathname: "/markets",
      theme: "light",
      locale: "en",
    });
    expect(nav).toContain("MVP Perps");
    expect(nav).toContain('href="/trade/BTC"');
    expect(nav).toContain('href="/markets"');
    expect(nav).toContain('href="/portfolio"');
    expect(nav).toContain('href="/vaults"');
    expect(nav).toContain('href="/referrals"');
  });

  it("marks the active route with aria-current=page", () => {
    const nav = renderShellNav({
      pathname: "/markets",
      theme: "light",
      locale: "en",
    });
    // The markets link is current; trade is not.
    expect(nav).toMatch(/href="\/markets" aria-current="page"/);
    expect(nav).not.toMatch(/href="\/trade\/BTC" aria-current="page"/);
  });

  it("treats /trade/:symbol as the active Trade route", () => {
    const nav = renderShellNav({
      pathname: "/trade/ETH",
      theme: "dark",
      locale: "en",
    });
    expect(nav).toMatch(
      /mvp-shell-navlink--active[^>]*href="\/trade\/BTC"|href="\/trade\/BTC"[^>]*aria-current="page"/,
    );
  });

  it("points Trade at the last-viewed symbol cookie when present", () => {
    const links = primaryNavLinks("eth");
    expect(links.find((l) => l.id === "trade")?.href).toBe("/trade/ETH");
    const nav = renderShellNav({
      pathname: "/markets",
      theme: "light",
      locale: "en",
      lastSymbol: "sol",
    });
    expect(nav).toContain('href="/trade/SOL"');
  });

  it("renders no-JS theme + locale switch links to the shell endpoints", () => {
    const nav = renderShellNav({
      pathname: "/portfolio",
      theme: "light",
      locale: "en",
    });
    // Theme cycles light -> dark; returnTo is the current path.
    expect(nav).toContain("/_shell/theme?value=dark");
    expect(nav).toContain("returnTo=%2Fportfolio");
    // Locale toggles en -> zh.
    expect(nav).toContain("/_shell/locale?value=zh");
    // Controls are anchors (usable with no JS).
    expect(nav).toMatch(/<a[^>]*data-shell-control="theme"/);
    expect(nav).toMatch(/<a[^>]*data-shell-control="locale"/);
  });
});

describe("shell chrome — composition", () => {
  const page =
    "<!doctype html><html><head><title>t</title></head><body><main>page body</main></body></html>";

  it("sets data-theme + <html lang> from the resolved preferences", () => {
    const dark = wrapShellChrome({
      html: page,
      pathname: "/markets",
      page: "@mvp/page-markets",
      theme: "dark",
      locale: "zh",
    });
    expect(dark).toContain('data-theme="dark"');
    expect(dark).toContain('lang="zh-CN"');

    const light = wrapShellChrome({
      html: page,
      pathname: "/",
      page: "@mvp/page-home",
      theme: "light",
      locale: "en",
    });
    expect(light).toContain('data-theme="light"');
    expect(light).toContain('lang="en-US"');
  });

  it("wraps the page content below the nav and preserves the route marker", () => {
    const out = wrapShellChrome({
      html: page,
      pathname: "/markets",
      page: "@mvp/page-markets",
      theme: "light",
      locale: "en",
    });
    expect(out).toContain('data-shell-nav="true"');
    expect(out).toContain('data-shell-gateway="true"');
    expect(out).toContain("@mvp/page-markets");
    expect(out).toContain("page body");
    // Nav appears before the page content in the composed body.
    expect(out.indexOf("data-shell-nav")).toBeLessThan(
      out.indexOf("page body"),
    );
  });

  it("injects the theme head into <head> and threads the nonce", () => {
    const out = wrapShellChrome({
      html: page,
      pathname: "/",
      page: "@mvp/page-home",
      theme: "system",
      locale: "en",
      nonce: "compose-nonce",
    });
    expect(out).toContain("--mvp-color-surface-1");
    expect(out).toContain('nonce="compose-nonce"');
    expect(out).toContain('data-theme="system"');
  });

  it("maps short locales to BCP-47 tags", () => {
    expect(localeToLang("en")).toBe("en-US");
    expect(localeToLang("zh")).toBe("zh-CN");
  });
});
