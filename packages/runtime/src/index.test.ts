import {
  type FragmentRegistry,
  loadDefaultBudget,
  type PageManifest,
  type RequestContext,
  type RouteManifest,
} from "@mvp/contracts";
import { createRequestTrace } from "@mvp/observability";
import { describe, expect, it, vi } from "vitest";
import {
  clearFragmentCache,
  composePage,
  createFragmentCacheKey,
  createFragmentHeaders,
  createFragmentSlotExecutionPlan,
  type FragmentSlotDefinition,
  fetchFragment,
  fetchFragmentSlots,
  mergeAssets,
  resolveFragment,
  resolveRoute,
  withTimeout,
} from "./index";

const ctx: RequestContext = {
  traceId: "trace-runtime",
  requestId: "req-runtime",
  locale: "en-US",
  tenant: "default",
  featureFlags: { canary: true },
  experiment: {},
  theme: "system",
  device: "desktop",
  userAgent: "vitest",
  timestamp: new Date("2026-01-01T00:00:00.000Z").toISOString(),
};

const routes: RouteManifest = {
  routes: [
    {
      id: "home",
      path: "/",
      page: "@mvp/page-home",
      serviceUrl: "http://localhost:4101",
      channel: "stable",
    },
    {
      id: "product",
      path: "/product/:id",
      page: "@mvp/page-product",
      serviceUrl: "http://localhost:4102",
      channel: "stable",
    },
  ],
};

const registry: FragmentRegistry = {
  fragments: {
    "promotion-banner": {
      stable: {
        version: "0.1.0",
        serviceUrl: "http://localhost:4201",
        manifestUrl: "http://localhost:4201/manifest",
      },
      canary: {
        version: "0.2.0",
        serviceUrl: "http://localhost:4201",
        manifestUrl: "http://localhost:4201/manifest",
      },
      versions: {
        "0.1.0": {
          version: "0.1.0",
          serviceUrl: "http://localhost:4201",
          manifestUrl: "http://localhost:4201/manifest",
        },
      },
    },
  },
};

describe("@mvp/runtime", () => {
  it("resolves home product and unknown routes", () => {
    expect(resolveRoute(routes, "/")?.page).toBe("@mvp/page-home");
    expect(resolveRoute(routes, "/product/123")?.page).toBe(
      "@mvp/page-product",
    );
    expect(resolveRoute(routes, "/missing")).toBeNull();
  });

  it("resolves stable canary and explicit fragment versions", () => {
    expect(
      resolveFragment(registry, "promotion-banner", "stable")?.version,
    ).toBe("0.1.0");
    expect(
      resolveFragment(registry, "promotion-banner", "canary")?.version,
    ).toBe("0.2.0");
    expect(
      resolveFragment(registry, "promotion-banner", "0.1.0")?.serviceUrl,
    ).toBe("http://localhost:4201");
  });

  it("fetches fragments and propagates trace headers", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["x-trace-id"]).toBe(
        "trace-runtime",
      );
      expect((init?.headers as Record<string, string>)["x-theme"]).toBe(
        "system",
      );
      expect((init?.headers as Record<string, string>)["x-device"]).toBe(
        "desktop",
      );
      return new Response(
        JSON.stringify({
          html: "<section>Hi</section>",
          assets: { js: ["/a.js"], css: ["/a.css"] },
          cache: { ttl: 60, tags: ["x"] },
          metadata: { name: "promotion-banner", version: "0.1.0" },
        }),
      );
    }) as unknown as typeof fetch;
    const response = await fetchFragment(
      { serviceUrl: "http://fragment", version: "0.1.0" },
      { ctx, props: {} },
      { fetchImpl },
    );
    expect(response.html).toContain("Hi");
  });

  it("schedules static cached and dynamic fragment slots", async () => {
    const cache = new Map();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      const name = String(url).includes("4201")
        ? "promotion-banner"
        : "recommendation-widget";
      return new Response(
        JSON.stringify({
          html: `<section data-fragment="${name}">${name}</section>`,
          assets: { js: [], css: [] },
          cache: { ttl: 60, tags: [name] },
          metadata: { name, version: "0.1.0" },
        }),
      );
    }) as unknown as typeof fetch;

    const slots = [
      {
        name: "static-copy",
        fragment: "static-copy",
        strategy: "static" as const,
        staticHtml:
          '<section data-fragment="static-copy">Static copy</section>',
      },
      {
        name: "promotion",
        fragment: "promotion-banner",
        strategy: "cached-ssr" as const,
        props: { scene: "home" },
      },
      {
        name: "recommendations",
        fragment: "recommendation-widget",
        strategy: "dynamic-ssr" as const,
        props: { scene: "home" },
      },
    ];

    const registryWithRecommendations: FragmentRegistry = {
      fragments: {
        ...registry.fragments,
        "recommendation-widget": {
          stable: {
            version: "0.1.0",
            serviceUrl: "http://localhost:4202",
            manifestUrl: "http://localhost:4202/manifest",
          },
        },
      },
    };

    const first = await fetchFragmentSlots({
      slots,
      registry: registryWithRecommendations,
      ctx,
      fetchImpl,
      cache,
    });
    const second = await fetchFragmentSlots({
      slots,
      registry: registryWithRecommendations,
      ctx,
      fetchImpl,
      cache,
    });

    expect(first["static-copy"].source).toBe("static");
    expect(first.promotion.source).toBe("network");
    expect(second.promotion.source).toBe("cache");
    expect(second.recommendations.source).toBe("network");
    expect(calls).toEqual([
      "http://localhost:4201/render",
      "http://localhost:4202/render",
      "http://localhost:4202/render",
    ]);
  });

  it("records a trace graph for slot scheduling, network calls, and cache hits", async () => {
    const cache = new Map();
    const trace = createRequestTrace({
      traceId: ctx.traceId,
      requestId: ctx.requestId,
    });
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          html: '<section data-fragment="promotion-banner">promotion</section>',
          assets: { js: [], css: [] },
          cache: { ttl: 60, tags: ["promotion"] },
          metadata: { name: "promotion-banner", version: "0.1.0" },
        }),
      );
    }) as unknown as typeof fetch;
    const slots: FragmentSlotDefinition[] = [
      {
        name: "promotion",
        fragment: "promotion-banner",
        strategy: "cached-ssr" as const,
        cachePolicy: {
          ttl: 60,
          tags: ["promotion"],
          vary: ["tenant", "locale", "props"],
        },
      },
    ];

    await fetchFragmentSlots({
      slots,
      registry,
      ctx,
      fetchImpl,
      cache,
      trace,
    });
    await fetchFragmentSlots({
      slots,
      registry,
      ctx,
      fetchImpl,
      cache,
      trace,
    });

    const snapshot = trace.toJSON();
    expect(
      snapshot.nodes.some((node) => node.name === "runtime.fetchFragmentSlots"),
    ).toBe(true);
    expect(snapshot.nodes.some((node) => node.name === "slot:promotion")).toBe(
      true,
    );
    expect(
      snapshot.nodes.some((node) => node.name === "fragment.http:promotion"),
    ).toBe(true);
    expect(snapshot.nodes.some((node) => node.kind === "cache")).toBe(true);
    expect(snapshot.edges.some((edge) => edge.type === "uses-cache")).toBe(
      true,
    );
    expect(trace.toDependencyGraphLog()).toContain("slot:promotion cache");
  });

  it("builds dependency levels and executes dependent slots after parents", async () => {
    const executionSlots: FragmentSlotDefinition[] = [
      { name: "hero", fragment: "hero-fragment" },
      {
        name: "details",
        fragment: "details-fragment",
        dependsOn: ["hero"],
      },
      { name: "recommendations", fragment: "recommendation-widget" },
    ];
    expect(
      createFragmentSlotExecutionPlan(executionSlots).map((level) =>
        level.map((slot) => slot.name),
      ),
    ).toEqual([["hero", "recommendations"], ["details"]]);

    const starts: string[] = [];
    const registryWithDependencies: FragmentRegistry = {
      fragments: {
        "hero-fragment": {
          stable: {
            version: "0.1.0",
            serviceUrl: "http://localhost:4301",
            manifestUrl: "http://localhost:4301/manifest",
          },
        },
        "details-fragment": {
          stable: {
            version: "0.1.0",
            serviceUrl: "http://localhost:4302",
            manifestUrl: "http://localhost:4302/manifest",
          },
        },
        "recommendation-widget": {
          stable: {
            version: "0.1.0",
            serviceUrl: "http://localhost:4202",
            manifestUrl: "http://localhost:4202/manifest",
          },
        },
      },
    };
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      starts.push(String(url));
      return Response.json({
        html: `<section>${url}</section>`,
        assets: { js: [], css: [] },
        cache: { ttl: 0, tags: [] },
        metadata: { name: String(url), version: "0.1.0" },
      });
    }) as unknown as typeof fetch;

    await fetchFragmentSlots({
      slots: executionSlots,
      registry: registryWithDependencies,
      ctx,
      fetchImpl,
    });

    expect(starts.indexOf("http://localhost:4302/render")).toBeGreaterThan(
      starts.indexOf("http://localhost:4301/render"),
    );
  });

  it("rejects missing dependencies and dependency cycles before execution", async () => {
    expect(() =>
      createFragmentSlotExecutionPlan([
        { name: "child", fragment: "x", dependsOn: ["missing"] },
      ]),
    ).toThrow('depends on missing slot "missing"');
    expect(() =>
      createFragmentSlotExecutionPlan([
        { name: "a", fragment: "a", dependsOn: ["b"] },
        { name: "b", fragment: "b", dependsOn: ["a"] },
      ]),
    ).toThrow("dependency cycle");
  });

  it("creates stable cache keys and clears cache", () => {
    const cache = new Map([
      [
        "key",
        {
          expiresAt: Date.now() + 1000,
          response: {
            html: "",
            assets: { js: [], css: [] },
            cache: { ttl: 1, tags: [] },
            metadata: { name: "x", version: "1" },
          },
        },
      ],
    ]);
    const first = createFragmentCacheKey(
      {
        name: "promo",
        fragment: "promotion-banner",
        strategy: "cached-ssr",
        props: { b: 2, a: 1 },
      },
      { version: "0.1.0", serviceUrl: "http://localhost:4201" },
      { ctx, props: { b: 2, a: 1 } },
    );
    const second = createFragmentCacheKey(
      {
        name: "promo",
        fragment: "promotion-banner",
        strategy: "cached-ssr",
        props: { a: 1, b: 2 },
      },
      { version: "0.1.0", serviceUrl: "http://localhost:4201" },
      { ctx, props: { a: 1, b: 2 } },
    );
    expect(first).toBe(second);
    clearFragmentCache(cache);
    expect(cache.size).toBe(0);
  });

  it("returns fallback on timeout and network error", async () => {
    await expect(
      withTimeout(
        new Promise((resolve) => setTimeout(() => resolve("late"), 20)),
        1,
        "fallback",
      ),
    ).resolves.toBe("fallback");
    const response = await fetchFragment(
      { serviceUrl: "http://bad", version: "0.1.0" },
      { ctx, props: {} },
      {
        fetchImpl: vi.fn(async () => {
          throw new Error("bad");
        }) as unknown as typeof fetch,
      },
    );
    expect(response.html).toContain("fallback");
  });

  it("composes page with SEO and fragment fallback isolation", () => {
    const page: PageManifest = {
      name: "home",
      route: "/",
      renderMode: "ssr",
      seo: { title: "首页标题", description: "首页描述" },
      budget: loadDefaultBudget("page", "home"),
      slots: [
        { name: "promo", fragment: "promotion-banner", required: false },
        { name: "bad", fragment: "recommendation-widget", required: false },
      ],
    };
    const html = composePage(
      page,
      {
        promo: {
          html: "<section>fragment HTML</section>",
          assets: { js: [], css: [] },
          cache: { ttl: 60, tags: [] },
          metadata: { name: "promotion-banner", version: "0.1.0" },
        },
        bad: new Error("down"),
      },
      ctx,
    );
    expect(html).toContain("首页标题");
    expect(html).toContain("fragment HTML");
    expect(html).toContain("recommendation-widget");
  });

  it("creates fragment headers and merges assets", () => {
    expect(createFragmentHeaders(ctx)["x-trace-id"]).toBe("trace-runtime");
    expect(
      mergeAssets([
        {
          html: "",
          assets: { js: ["/a.js", "/a.js"], css: ["/a.css"] },
          cache: { ttl: 1, tags: [] },
          metadata: { name: "a", version: "1" },
        },
        {
          html: "",
          assets: { js: ["/b.js"], css: ["/a.css"] },
          cache: { ttl: 1, tags: [] },
          metadata: { name: "b", version: "1" },
        },
      ]),
    ).toEqual({ js: ["/a.js", "/b.js"], css: ["/a.css"] });
  });
});
