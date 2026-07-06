import { clearFragmentCache } from "@mvp/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { homePageBudget } from "../src/budget";
import { fetchHomeFragmentSlots } from "../src/fragmentSlots";
import { homePageManifest, validateHomePageManifest } from "../src/manifest";
import { metadata } from "../src/metadata";
import { renderHomeHtml, usedUiComponents } from "../src/render";

describe("page-home", () => {
  beforeEach(() => {
    clearFragmentCache();
  });

  it("SSR HTML contains core SEO copy", () => {
    const html = renderHomeHtml();
    expect(html).toContain("MVP Storefront Home");
    expect(html).toContain("Discover curated offers");
    expect(html).toContain("No-JS readable collection");
  });

  it("metadata includes title and description", () => {
    expect(metadata).toMatchObject({
      title: homePageManifest.seo.title,
      description: homePageManifest.seo.description,
    });
  });

  it("page manifest passes validation", () => {
    expect(validateHomePageManifest()).toBe(true);
  });

  it("fragment success HTML is included", () => {
    const html = renderHomeHtml({
      promotion: "<section>Promotion fragment</section>",
    });
    expect(html).toContain("Promotion fragment");
  });

  it("fetches real fragment slots through registry render endpoints", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      const name = String(url).includes("4201")
        ? "promotion-banner"
        : "recommendation-widget";
      return new Response(
        JSON.stringify({
          html: `<section>${name} live</section>`,
          assets: { js: [], css: [] },
          cache: { ttl: 60, tags: [name] },
          metadata: { name, version: "0.1.0" },
        }),
      );
    }) as typeof fetch;

    const slots = await fetchHomeFragmentSlots({
      fetchImpl,
      headers: new Headers({ "x-trace-id": "trace-home-fragments" }),
    });

    expect(calls).toEqual([
      "http://localhost:4201/render",
      "http://localhost:4202/render",
    ]);
    expect(slots.staticEditorial).toContain("Static SSG sample");
    expect(slots.promotion).toContain("promotion-banner live");
    expect(slots.recommendations).toContain("recommendation-widget live");
    expect(slots.diagnostics.staticEditorial).toMatchObject({
      source: "static",
      strategy: "static",
    });
    expect(slots.diagnostics.promotion.strategy).toBe("cached-ssr");
    expect(slots.diagnostics.recommendations.strategy).toBe("dynamic-ssr");
    expect(slots.dataDiagnostics.featuredContent).toMatchObject({
      firstRead: "loader",
      secondRead: "pending",
      title: "Featured content",
    });
    expect(slots.traceLog).toContain("data:home-featured-content");
    expect(slots.traceLog).toContain("runtime.fetchFragmentSlots");
    expect(slots.traceLog).toContain("slot:promotion");
  });

  it("caches cached-ssr promotion while dynamic recommendations refetch", async () => {
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
          cache: { ttl: 60, tags: [name] },
          metadata: { name, version: "0.1.0" },
        }),
      );
    }) as typeof fetch;

    await fetchHomeFragmentSlots({ fetchImpl });
    const second = await fetchHomeFragmentSlots({ fetchImpl });

    expect(second.diagnostics.promotion.source).toBe("cache");
    expect(second.diagnostics.recommendations.source).toBe("network");
    expect(calls).toEqual([
      "http://localhost:4201/render",
      "http://localhost:4202/render",
      "http://localhost:4202/render",
    ]);
  });

  it("keeps slot fallback html when fragment render fails", async () => {
    const slots = await fetchHomeFragmentSlots({
      fetchImpl: (async () => {
        throw new Error("fragment down");
      }) as typeof fetch,
      timeoutMs: 5,
    });

    expect(slots.promotion).toContain("data-fallback");
    expect(slots.recommendations).toContain("data-fallback");
  });

  it("fragment failure keeps SEO core content", () => {
    const html = renderHomeHtml({ promotion: null, recommendations: null });
    expect(html).toContain("MVP Storefront Home");
    expect(html).toContain("data-fallback");
  });

  it("declares budget and UI component usage", () => {
    expect(homePageBudget.scope).toBe("page");
    expect(usedUiComponents).toContain("Section");
  });
});
