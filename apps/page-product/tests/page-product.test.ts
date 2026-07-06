import { clearFragmentCache } from "@mvp/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { productPageBudget } from "../src/budget";
import { fetchProductFragmentSlots } from "../src/fragmentSlots";
import {
  productPageManifest,
  validateProductPageManifest,
} from "../src/manifest";
import {
  createProductJsonLd,
  renderProductHtml,
  usedUiComponents,
} from "../src/render";

describe("page-product", () => {
  beforeEach(() => {
    clearFragmentCache();
  });

  it("SSR/SSG HTML contains product title and price", () => {
    const html = renderProductHtml("123");
    expect(html).toContain("Everyday Travel Pack");
    expect(html).toContain("$79");
    expect(html).toContain("Everyday Travel Pack in slate fabric");
  });

  it("includes Product JSON-LD", () => {
    const html = renderProductHtml("123");
    expect(html).toContain('type="application/ld+json"');
    expect(createProductJsonLd("123")).toMatchObject({
      "@type": "Product",
      name: "Everyday Travel Pack",
    });
  });

  it("keeps core SEO content when fragments fail", () => {
    const html = renderProductHtml("123", {
      recommendations: null,
      pricePanel: null,
    });
    expect(html).toContain("Everyday Travel Pack");
    expect(html).toContain("data-fallback");
  });

  it("fetches ISR promotion and dynamic recommendation fragments", async () => {
    const calls: string[] = [];
    const slots = await fetchProductFragmentSlots({
      fetchImpl: (async (url: string | URL | Request) => {
        calls.push(String(url));
        const name = String(url).includes("4201")
          ? "promotion-banner"
          : "recommendation-widget";
        return new Response(
          JSON.stringify({
            html: `<section>${name} for product</section>`,
            assets: { js: [], css: [] },
            cache: { ttl: 120, tags: [name] },
            metadata: { name, version: "0.1.0" },
          }),
        );
      }) as typeof fetch,
    });

    expect(calls).toEqual([
      "http://localhost:4201/render",
      "http://localhost:4202/render",
    ]);
    expect(slots.staticProof).toContain("Static product proof");
    expect(slots.promotion).toContain("promotion-banner for product");
    expect(slots.recommendations).toContain(
      "recommendation-widget for product",
    );
    expect(slots.diagnostics.staticProof.source).toBe("static");
    expect(slots.diagnostics.promotion.strategy).toBe("isr");
    expect(slots.diagnostics.recommendations.strategy).toBe("dynamic-ssr");
    expect(slots.dataDiagnostics.productSummary).toMatchObject({
      firstRead: "loader",
      secondRead: "pending",
      label: "Product summary",
    });
    expect(slots.traceLog).toContain("data:product-summary");
    expect(slots.traceLog).toContain("runtime.fetchFragmentSlots");
    expect(slots.traceLog).toContain("slot:promotion");
  });

  it("caches ISR promotion while dynamic recommendations refetch", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      const name = String(url).includes("4201")
        ? "promotion-banner"
        : "recommendation-widget";
      return new Response(
        JSON.stringify({
          html: `<section>${name} cache case</section>`,
          assets: { js: [], css: [] },
          cache: { ttl: 120, tags: [name] },
          metadata: { name, version: "0.1.0" },
        }),
      );
    }) as typeof fetch;

    await fetchProductFragmentSlots({ fetchImpl });
    const second = await fetchProductFragmentSlots({ fetchImpl });

    expect(second.diagnostics.promotion.source).toBe("cache");
    expect(second.diagnostics.recommendations.source).toBe("network");
    expect(calls).toEqual([
      "http://localhost:4201/render",
      "http://localhost:4202/render",
      "http://localhost:4202/render",
    ]);
  });

  it("page manifest passes validation", () => {
    expect(validateProductPageManifest()).toBe(true);
  });

  it("declares budget and UI component usage", () => {
    expect(productPageBudget.scope).toBe("page");
    expect(usedUiComponents).toContain("ProductCardBase");
    expect(productPageManifest.slots.map((slot) => slot.fragment)).toContain(
      "recommendation-widget",
    );
    expect(
      productPageManifest.slots
        .map((slot) => ("strategy" in slot ? slot.strategy : undefined))
        .filter(Boolean),
    ).toContain("isr");
  });
});
