import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The trade layout owns theme/locale + injects the shared `AppNav` stylesheet;
 * the `AppNav` element itself is rendered by the trade page (it knows the active
 * symbol). This fixes the shell-injected-chrome hydration mismatch (React #418).
 * Driven as an SSR server component with a mocked `next/headers`.
 */

let cookieHeader = "";

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(cookieHeader ? { cookie: cookieHeader } : {}),
}));

async function renderLayout(): Promise<string> {
  const { default: RootLayout } = await import("../app/layout");
  const element = await RootLayout({
    children: createElement("main", { "data-page": "trade" }),
  });
  return renderToStaticMarkup(element);
}

describe("page-trade layout", () => {
  beforeEach(() => {
    cookieHeader = "";
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
