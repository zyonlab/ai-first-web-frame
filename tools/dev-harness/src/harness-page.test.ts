import { describe, expect, it } from "vitest";
import { renderHarnessPage } from "./harness-page";
import type { MockWorld } from "./mock-world";

const world: MockWorld = {
  component: "order-form",
  seededSlices: { "trade.active-symbol": { symbol: "BTC" } },
  mockDataSources: ["account"],
  injectSlices: ["trade.active-symbol"],
  observeSlices: ["trade.leverage", "trade.order-draft"],
  layoutHint: { shape: "panel", fills: true, minHeight: 240 },
};

describe("renderHarnessPage", () => {
  const html = renderHarnessPage({
    name: "order-form",
    themeCss: ":where(:root){--mvp-color-ink:#fff}",
    fragmentHtml: '<section data-fragment="order-form">SSR HERE</section>',
    world,
    serviceUrl: "http://localhost:4205",
  });

  it("embeds the fragment SSR inside a themed, hint-sized pane", () => {
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain("SSR HERE");
    expect(html).toContain("data-harness-pane");
    expect(html).toContain("min-height:240px");
    expect(html).toContain("--mvp-color-ink:#fff");
  });

  it("lists the contract-mocked world (inject / mock / observe)", () => {
    expect(html).toContain("trade.active-symbol");
    expect(html).toContain("account");
    expect(html).toContain("trade.leverage");
    expect(html).toContain("trade.order-draft");
    // seeded value shown (JSON) next to the inject channel
    expect(html).toContain('{"symbol":"BTC"}');
  });

  it("escapes fragment HTML control chars in sidebar values only (SSR passes through)", () => {
    // The SSR is trusted framework output and passes through; sidebar ids are escaped.
    const evil = renderHarnessPage({
      name: "x",
      themeCss: "",
      fragmentHtml: "<b>ok</b>",
      world: { ...world, mockDataSources: ["a<b>c"] },
    });
    expect(evil).toContain("a&lt;b&gt;c");
    expect(evil).toContain("<b>ok</b>");
  });
});
