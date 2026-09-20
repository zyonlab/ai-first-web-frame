import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * page-product's layout wires the `@mvp/assets` plane (collected theme CSS + i18n
 * message descriptors into <head>, children into <body>) and — since the SEO
 * fix — resolves `<html lang>`/`data-theme` from the request cookies like the
 * five trade-suite pages already did. It used to hard-code `lang="en"` while
 * injecting zh-CN copy, which is a self-contradicting language signal.
 */

let cookieHeader = "";

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(cookieHeader ? { cookie: cookieHeader } : {}),
}));

async function renderLayout(): Promise<string> {
  const { default: RootLayout } = await import("../app/layout");
  const element = await RootLayout({
    children: createElement("main", { "data-page": "product" }),
  });
  return renderToStaticMarkup(element);
}

describe("page-product layout", () => {
  beforeEach(() => {
    cookieHeader = "";
  });

  it("renders the html shell with the resolved lang and theme", async () => {
    const html = await renderLayout();
    expect(html).toContain('lang="en-US"');
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('<main data-page="product">');
  });

  it("reflects the locale cookie in <html lang>", async () => {
    cookieHeader = "mvp_locale=zh";
    const html = await renderLayout();
    expect(html).toContain('lang="zh-CN"');
  });

  it("honors an explicit light theme cookie", async () => {
    cookieHeader = "mvp_theme=light";
    const html = await renderLayout();
    expect(html).toContain('data-theme="light"');
  });

  it("injects the collected theme CSS from @mvp/assets", async () => {
    const html = await renderLayout();
    expect(html).toContain("--mvp-page-accent:#7c2d12");
  });

  it("injects both i18n message descriptors from @mvp/assets", async () => {
    const html = await renderLayout();
    expect(html).toContain("Product details");
    expect(html).toContain("商品详情");
  });
});
