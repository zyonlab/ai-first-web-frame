import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The markets layout now owns theme/locale + renders the shared `AppNav` inside
 * its own React tree (fixing the shell-injected-chrome hydration mismatch,
 * React #418). These tests drive the layout as an SSR server component with a
 * mocked `next/headers` cookie source.
 */

let cookieHeader = "";

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(cookieHeader ? { cookie: cookieHeader } : {}),
}));

async function renderLayout(): Promise<string> {
  const { default: RootLayout } = await import("../app/layout");
  const element = await RootLayout({
    children: createElement("main", { "data-page": "markets" }),
  });
  return renderToStaticMarkup(element);
}

describe("page-markets layout", () => {
  beforeEach(() => {
    cookieHeader = "";
  });

  it("renders the shared AppNav with every primary link", async () => {
    const html = await renderLayout();
    expect(html).toContain('data-shell-nav="true"');
    expect(html).toContain("MVP Perps");
    expect(html).toContain('href="/trade/BTC"');
    expect(html).toContain('href="/markets"');
    expect(html).toContain('href="/portfolio"');
    expect(html).toContain('href="/vaults"');
    expect(html).toContain('href="/referrals"');
  });

  it("marks the Markets link active via aria-current", async () => {
    const html = await renderLayout();
    expect(html).toMatch(/href="\/markets"[^>]*aria-current="page"/);
  });

  it("defaults data-theme=system + lang en-US with no cookies", async () => {
    const html = await renderLayout();
    expect(html).toContain('data-theme="system"');
    expect(html).toContain('lang="en-US"');
  });

  it("resolves data-theme + lang from the preference cookies", async () => {
    cookieHeader = "mvp_theme=dark; mvp_locale=zh";
    const html = await renderLayout();
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('lang="zh-CN"');
  });

  it("injects the AppNav stylesheet + design-system tokens into <head>", async () => {
    const html = await renderLayout();
    expect(html).toContain(".mvp-shell-nav");
    expect(html).toContain("--mvp-color-surface-1");
  });
});
