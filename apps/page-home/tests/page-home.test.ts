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

    // recommendations (4202) has no dependencies so it runs in the first
    // level; promotion (4201) is gated behind the shared featured-content data
    // node and runs in the next level.
    expect(calls).toEqual([
      "http://localhost:4202/render",
      "http://localhost:4201/render",
    ]);
    expect(slots.html.staticEditorial).toContain("Static SSG sample");
    expect(slots.html.promotion).toContain("promotion-banner live");
    expect(slots.html.recommendations).toContain("recommendation-widget live");
    expect(slots.diagnostics.staticEditorial).toMatchObject({
      source: "static",
      strategy: "static",
      status: "ok",
      required: false,
    });
    expect(slots.diagnostics.promotion).toMatchObject({
      strategy: "cached-ssr",
      status: "ok",
      required: true,
    });
    expect(slots.diagnostics.recommendations).toMatchObject({
      strategy: "dynamic-ssr",
      required: false,
    });
    expect(slots.dataDiagnostics.featuredContent).toMatchObject({
      firstRead: "loader",
      secondRead: "pending",
      title: "Featured content",
    });
    expect(slots.scheduler.health).toBe("ok");
    expect(Array.isArray(slots.scheduler.hints)).toBe(true);
    expect(slots.traceLog).toContain("data:home-featured-content");
    expect(slots.traceLog).toContain("runtime.fetchFragmentSlots");
    expect(slots.traceLog).toContain("slot:promotion");
  });

  it("reports degraded health when the optional recommendations slot fails", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      // Promotion (required, port 4201) succeeds; recommendations (4202) fails.
      if (String(url).includes("4202")) throw new Error("recommendations down");
      return new Response(
        JSON.stringify({
          html: "<section>promotion-banner live</section>",
          assets: { js: [], css: [] },
          cache: { ttl: 60, tags: ["promotion-banner"] },
          metadata: { name: "promotion-banner", version: "0.1.0" },
        }),
      );
    }) as typeof fetch;

    const slots = await fetchHomeFragmentSlots({ fetchImpl, timeoutMs: 20 });

    expect(slots.scheduler.health).toBe("degraded");
    expect(slots.diagnostics.promotion.status).toBe("ok");
    expect(slots.diagnostics.recommendations.status).toBe("fallback");
    expect(slots.html.recommendations).toContain("data-fallback");
  });

  it("reports unhealthy when the required promotion slot fails", async () => {
    const slots = await fetchHomeFragmentSlots({
      fetchImpl: (async () => {
        throw new Error("fragment down");
      }) as typeof fetch,
      timeoutMs: 5,
    });

    expect(slots.scheduler.health).toBe("unhealthy");
    expect(slots.diagnostics.promotion.status).toBe("fallback");
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
    // First pass: recommendations (level 0) then promotion (level 1, behind
    // data). Second pass: promotion is served from cache (no call) while
    // dynamic recommendations refetch.
    expect(calls).toEqual([
      "http://localhost:4202/render",
      "http://localhost:4201/render",
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

    expect(slots.html.promotion).toContain("data-fallback");
    expect(slots.html.recommendations).toContain("data-fallback");
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
