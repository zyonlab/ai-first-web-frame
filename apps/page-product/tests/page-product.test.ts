import { createRequestContext } from "@mvp/request-context";
import { clearFragmentCache } from "@mvp/runtime";
import { createCookieStorageAdapter } from "@mvp/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as healthGet } from "../app/health/route";
import { resetProductStatsWorker } from "../src/backgroundJobs";
import { productPageBudget } from "../src/budget";
import { fetchProductFragmentSlots } from "../src/fragmentSlots";
import {
  productPageManifest,
  validateProductPageManifest,
} from "../src/manifest";
import {
  RECENTLY_VIEWED_SECRET,
  trackRecentlyViewed,
} from "../src/recentlyViewed";
import {
  createProductJsonLd,
  renderProductHtml,
  usedUiComponents,
} from "../src/render";

function successFetch(): typeof fetch {
  return (async (url: string | URL | Request) => {
    const name = String(url).includes("4201")
      ? "promotion-banner"
      : "recommendation-widget";
    return new Response(
      JSON.stringify({
        html: `<section>${name}</section>`,
        assets: { js: [], css: [] },
        cache: { ttl: 120, tags: [name] },
        metadata: { name, version: "0.1.0" },
      }),
    );
  }) as typeof fetch;
}

describe("page-product", () => {
  beforeEach(() => {
    clearFragmentCache();
    resetProductStatsWorker();
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

  it("fetches TTL-cache promotion and dynamic recommendation fragments", async () => {
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
    expect(slots.diagnostics.promotion.strategy).toBe("ttl-cache");
    expect(slots.diagnostics.recommendations.strategy).toBe("dynamic-ssr");
    expect(slots.dataDiagnostics.productSummary).toMatchObject({
      firstRead: "ok",
      secondRead: "resolved x1",
      label: "Product summary",
    });
    expect(slots.traceLog).toContain("data:product-summary");
    expect(slots.traceLog).toContain("runtime.fetchFragmentSlots");
    expect(slots.traceLog).toContain("slot:promotion");
  });

  it("caches TTL-cache promotion while dynamic recommendations refetch", async () => {
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
    ).toContain("ttl-cache");
  });

  describe("signed cookie storage (recently viewed)", () => {
    it("writes a signed Set-Cookie and reads it back verified", async () => {
      const ctx = createRequestContext({
        headers: new Headers({ "x-tenant": "acme", "x-user-id": "u-1" }),
      });

      // First visit: no incoming cookie, product 123 recorded.
      const first = await trackRecentlyViewed({
        ctx,
        productId: "123",
        cookieHeader: "",
      });
      expect(first.entries.map((entry) => entry.id)).toEqual(["123"]);
      expect(first.verified).toBe(false);
      expect(first.setCookies).toHaveLength(1);
      const setCookie = first.setCookies[0];
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Max-Age=");

      // Rebuild the incoming Cookie header from the emitted Set-Cookie header.
      const nameValue = setCookie.split(";")[0];
      const cookieHeader = nameValue;

      // Second visit for a different product: previous id survives, deduped,
      // most-recent-first, and the signed cookie verified on the way in.
      const second = await trackRecentlyViewed({
        ctx,
        productId: "999",
        cookieHeader,
      });
      expect(second.verified).toBe(true);
      expect(second.entries.map((entry) => entry.id)).toEqual(["999", "123"]);
    });

    it("treats a tampered signed cookie as absent", async () => {
      const ctx = createRequestContext({
        headers: new Headers({ "x-tenant": "acme", "x-user-id": "u-1" }),
      });
      const first = await trackRecentlyViewed({
        ctx,
        productId: "123",
        cookieHeader: "",
      });
      // Flip the last character of the signature to break the HMAC.
      const nameValue = first.setCookies[0].split(";")[0];
      const tampered =
        nameValue.slice(0, -1) + (nameValue.endsWith("A") ? "B" : "A");

      const second = await trackRecentlyViewed({
        ctx,
        productId: "999",
        cookieHeader: tampered,
      });
      // Tampered value fails verification, so history resets to just 999.
      expect(second.verified).toBe(false);
      expect(second.entries.map((entry) => entry.id)).toEqual(["999"]);
    });

    it("signs values with the env-configured secret", async () => {
      const adapter = createCookieStorageAdapter({
        secret: RECENTLY_VIEWED_SECRET,
      });
      await adapter.set("k", "v");
      const [header] = adapter.toSetCookieHeaders();
      // Signed value is "value.signature"; base64url signature is present.
      expect(header).toMatch(/k=v\.[A-Za-z0-9_-]+/);
    });
  });

  describe("background worker (product stats warmer)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("enqueues a job and completes it with propagated trace ids", async () => {
      vi.useFakeTimers();
      const now = () => 1000;
      const slots = await fetchProductFragmentSlots({
        headers: new Headers({
          "x-trace-id": "trace-abc-123",
          "x-request-id": "req-9",
          "x-tenant": "acme",
        }),
        fetchImpl: successFetch(),
        awaitBackgroundJob: true,
        now,
      });

      expect(slots.backgroundJobs.status).toBe("completed");
      expect(slots.backgroundJobs.taskId).toContain("product-stats-warmer");
      expect(slots.backgroundJobs.stats.deadLetters).toBe(0);
      // The worker task carried the request's trace/request ids end to end.
      expect(slots.traceLog).toContain("trace-abc-123");
    });

    it("reports a queued status when the job is not awaited", async () => {
      const slots = await fetchProductFragmentSlots({
        headers: new Headers({ "x-tenant": "acme" }),
        fetchImpl: successFetch(),
      });
      expect(slots.backgroundJobs.status).toBe("queued");
    });
  });

  describe("DAG data dependencies", () => {
    it("resolves each data node exactly once and reports health/hints", async () => {
      const slots = await fetchProductFragmentSlots({
        headers: new Headers({ "x-tenant": "acme" }),
        fetchImpl: successFetch(),
      });

      // product-summary feeds both product-price and product-promotion but is
      // resolved only once, proving DAG de-duplication.
      expect(slots.dag.resolveCounts["product-summary"]).toBe(1);
      expect(slots.dag.resolveCounts["product-price"]).toBe(1);
      expect(slots.dag.resolveCounts["product-promotion"]).toBe(1);
      expect(slots.dag.data["product-summary"]).toBe("ok");
      expect(slots.dag.health).toBe("ok");
      expect(Array.isArray(slots.dag.hints)).toBe(true);
      expect(slots.traceLog).toContain("data:product-summary");
    });
  });

  describe("/health route", () => {
    it("returns ok status for the page-product service", async () => {
      const response = await healthGet();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status: "ok", service: "page-product" });
    });
  });
});
