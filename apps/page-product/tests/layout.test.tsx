import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLayout from "../app/layout";

/**
 * page-product's layout is the storefront variant: no AppNav, no
 * cookie-driven theming (both by design — the trade-suite pages own that
 * pattern; see page-markets/tests/layout.test.tsx). What it MUST do is wire
 * the `@mvp/assets` plane: collected theme CSS + i18n message descriptors
 * into <head>, children into <body>.
 */
function renderLayout(): string {
  return renderToStaticMarkup(
    RootLayout({
      children: createElement("main", { "data-page": "product" }),
    }),
  );
}

describe("page-product layout", () => {
  it("renders the html shell with lang and system theme", () => {
    const html = renderLayout();
    expect(html).toContain('lang="en"');
    expect(html).toContain('data-theme="system"');
    expect(html).toContain('<main data-page="product">');
  });

  it("injects the collected theme CSS from @mvp/assets", () => {
    const html = renderLayout();
    expect(html).toContain("--mvp-page-accent:#7c2d12");
  });

  it("injects both i18n message descriptors from @mvp/assets", () => {
    const html = renderLayout();
    expect(html).toContain("Product details");
    expect(html).toContain("商品详情");
  });
});
