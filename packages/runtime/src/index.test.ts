import {
  type FragmentRegistry,
  loadDefaultBudget,
  type PageManifest,
  type ReleaseChannel,
  type RequestContext,
  type RouteManifest,
} from "@mvp/contracts";
import { createRequestTrace } from "@mvp/observability";
import { describe, expect, it, vi } from "vitest";
import {
  applySlotRequestOverrides,
  clearFragmentCache,
  collectSlotDiagnostics,
  composePage,
  createFallbackResponse,
  createFragmentCacheKey,
  createFragmentHeaders,
  createFragmentSlotExecutionPlan,
  createSlotDataExecutionPlan,
  DEFAULT_RENDER_STRATEGY,
  executeFragmentSlots,
  type FragmentSlotDefinition,
  type FragmentSlotResult,
  type FragmentSlotsExecution,
  fetchFragment,
  fetchFragmentSlots,
  isFallbackResponse,
  mergeAssets,
  type RuntimeTrace,
  resolveFragment,
  resolveFragmentStream,
  resolveRoute,
  type SchedulerHint,
  streamFragmentSlots,
  toSlotDiagnostic,
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

  it("degrades schema-invalid and non-JSON /render responses to fallback, loudly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Valid JSON, invalid contract: html must be a string.
      const invalid = await fetchFragment(
        { serviceUrl: "http://fragment", version: "0.1.0" },
        { ctx, props: {} },
        {
          fetchImpl: vi.fn(
            async () =>
              new Response(
                JSON.stringify({
                  html: 42,
                  assets: { js: [], css: [] },
                  cache: { ttl: 60, tags: [] },
                  metadata: { name: "promotion-banner", version: "0.1.0" },
                }),
              ),
          ) as unknown as typeof fetch,
        },
      );
      expect(isFallbackResponse(invalid)).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("FragmentRenderResponseSchema"),
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("html"));

      // Non-JSON body: degrades the same way (json() rejection), no warn —
      // that's a transport failure, not a contract violation.
      warn.mockClear();
      const nonJson = await fetchFragment(
        { serviceUrl: "http://fragment", version: "0.1.0" },
        { ctx, props: {} },
        {
          fetchImpl: vi.fn(
            async () => new Response("<html>gateway error</html>"),
          ) as unknown as typeof fetch,
        },
      );
      expect(isFallbackResponse(nonJson)).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("records the degrade reason on the trace span when a response fails the schema", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ended: Array<{
      status?: string;
      attributes?: Record<string, unknown>;
    }> = [];
    const trace = {
      startSpan: () => "span-1",
      endSpan: (
        _id: string,
        end?: { status?: string; attributes?: Record<string, unknown> },
      ) => {
        ended.push(end ?? {});
      },
      addDependency: () => {},
    } as unknown as RuntimeTrace;
    try {
      await fetchFragment(
        { serviceUrl: "http://fragment", version: "0.1.0" },
        { ctx, props: {} },
        {
          trace,
          fetchImpl: vi.fn(
            async () => new Response("{}"),
          ) as unknown as typeof fetch,
        },
      );
      expect(ended).toHaveLength(1);
      expect(ended[0]?.status).toBe("fallback");
      expect(String(ended[0]?.attributes?.error)).toContain(
        "FragmentRenderResponseSchema",
      );
    } finally {
      warn.mockRestore();
    }
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

  describe("scheduler semantics", () => {
    const graphRegistry: FragmentRegistry = {
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
        "promo-fragment": {
          stable: {
            version: "0.1.0",
            serviceUrl: "http://localhost:4303",
            manifestUrl: "http://localhost:4303/manifest",
          },
        },
      },
    };

    function createOkFetch(calls: string[] = []) {
      return vi.fn(async (url: string | URL | Request) => {
        calls.push(String(url));
        return Response.json({
          html: `<section>${String(url)}</section>`,
          assets: { js: [], css: [] },
          cache: { ttl: 0, tags: [] },
          metadata: { name: String(url), version: "0.1.0" },
        });
      }) as unknown as typeof fetch;
    }

    it("reports ok health and per-slot status when everything succeeds", async () => {
      const execution = await executeFragmentSlots({
        slots: [
          { name: "hero", fragment: "hero-fragment", required: true },
          { name: "promo", fragment: "promo-fragment" },
        ],
        registry: graphRegistry,
        ctx,
        fetchImpl: createOkFetch(),
      });
      expect(execution.health).toBe("ok");
      expect(execution.slots.hero.status).toBe("ok");
      expect(execution.slots.promo.status).toBe("ok");
      expect(execution.hints).toEqual([]);
    });

    it("marks page unhealthy when a required slot falls back", async () => {
      const execution = await executeFragmentSlots({
        slots: [
          { name: "hero", fragment: "missing-fragment", required: true },
          { name: "promo", fragment: "promo-fragment" },
        ],
        registry: graphRegistry,
        ctx,
        fetchImpl: createOkFetch(),
      });
      expect(execution.health).toBe("unhealthy");
      expect(execution.slots.hero.status).toBe("fallback");
      expect(execution.slots.hero.response.html).toContain(
        'data-fallback="true"',
      );
      expect(execution.slots.promo.status).toBe("ok");
    });

    it("marks page degraded when an optional slot falls back", async () => {
      const execution = await executeFragmentSlots({
        slots: [
          { name: "hero", fragment: "missing-fragment" },
          { name: "promo", fragment: "promo-fragment" },
        ],
        registry: graphRegistry,
        ctx,
        fetchImpl: createOkFetch(),
      });
      expect(execution.health).toBe("degraded");
      expect(execution.slots.hero.status).toBe("fallback");
      expect(execution.slots.promo.status).toBe("ok");
    });

    it("skips slots depending on a failed required slot", async () => {
      const calls: string[] = [];
      const fetchImpl = createOkFetch(calls);
      const execution = await executeFragmentSlots({
        slots: [
          { name: "hero", fragment: "missing-fragment", required: true },
          {
            name: "details",
            fragment: "details-fragment",
            dependsOn: ["hero"],
          },
        ],
        registry: graphRegistry,
        ctx,
        fetchImpl,
      });
      expect(execution.health).toBe("unhealthy");
      expect(execution.slots.details.status).toBe("skipped-dependency");
      expect(execution.slots.details.source).toBe("fallback");
      expect(execution.slots.details.response.html).toContain(
        'data-fallback="true"',
      );
      expect(calls).toEqual([]);
    });

    it("still executes slots depending on a failed optional slot", async () => {
      const execution = await executeFragmentSlots({
        slots: [
          { name: "hero", fragment: "missing-fragment" },
          {
            name: "details",
            fragment: "details-fragment",
            dependsOn: ["hero"],
          },
        ],
        registry: graphRegistry,
        ctx,
        fetchImpl: createOkFetch(),
      });
      expect(execution.health).toBe("degraded");
      expect(execution.slots.details.status).toBe("ok");
      expect(execution.slots.details.source).toBe("network");
    });

    it("throws on required slot failure when policy is throw", async () => {
      await expect(
        executeFragmentSlots({
          slots: [
            { name: "hero", fragment: "missing-fragment", required: true },
          ],
          registry: graphRegistry,
          ctx,
          fetchImpl: createOkFetch(),
          onRequiredFailure: "throw",
        }),
      ).rejects.toThrow("required fragment slots failed: hero");
    });

    it("resolves shared data once before dependent slots run concurrently", async () => {
      const order: string[] = [];
      const resolveData = vi.fn(async (id: string) => {
        order.push(`data:${id}`);
        return { id };
      });
      const fetchImpl = createOkFetch(order);
      const trace = createRequestTrace({
        traceId: ctx.traceId,
        requestId: ctx.requestId,
      });
      const execution = await executeFragmentSlots({
        slots: [
          {
            name: "hero",
            fragment: "hero-fragment",
            dataDependencies: ["featured"],
          },
          {
            name: "details",
            fragment: "details-fragment",
            dataDependencies: ["featured"],
          },
        ],
        registry: graphRegistry,
        ctx,
        fetchImpl,
        resolveData,
        trace,
      });
      expect(resolveData).toHaveBeenCalledTimes(1);
      expect(order[0]).toBe("data:featured");
      expect(order).toHaveLength(3);
      expect(execution.health).toBe("ok");
      expect(execution.data.featured).toEqual({
        id: "featured",
        status: "ok",
        value: { id: "featured" },
      });
      const snapshot = trace.toJSON();
      expect(
        snapshot.nodes.some(
          (node) => node.name === "data:featured" && node.kind === "data",
        ),
      ).toBe(true);
    });

    it("resolves data-to-data dependencies in order", async () => {
      const order: string[] = [];
      const resolveData = vi.fn(async (id: string) => {
        order.push(`data:${id}`);
        return id;
      });
      await executeFragmentSlots({
        slots: [
          {
            name: "hero",
            fragment: "hero-fragment",
            dataDependencies: ["derived"],
          },
        ],
        registry: graphRegistry,
        ctx,
        fetchImpl: createOkFetch(order),
        resolveData,
        dataDependencies: [
          { id: "base" },
          { id: "derived", dependsOn: ["base"] },
        ],
      });
      expect(order.indexOf("data:base")).toBeLessThan(
        order.indexOf("data:derived"),
      );
      expect(order.indexOf("data:derived")).toBeLessThan(
        order.indexOf("http://localhost:4301/render"),
      );
    });

    it("skips slots whose data dependency fails and derives health from required flag", async () => {
      const calls: string[] = [];
      const failingResolver = vi.fn(async () => {
        throw new Error("data source down");
      });
      const unhealthy = await executeFragmentSlots({
        slots: [
          {
            name: "hero",
            fragment: "hero-fragment",
            required: true,
            dataDependencies: ["featured"],
          },
        ],
        registry: graphRegistry,
        ctx,
        fetchImpl: createOkFetch(calls),
        resolveData: failingResolver,
      });
      expect(unhealthy.health).toBe("unhealthy");
      expect(unhealthy.slots.hero.status).toBe("skipped-dependency");
      expect(unhealthy.data.featured.status).toBe("error");
      expect(unhealthy.data.featured.error).toContain("data source down");
      expect(calls).toEqual([]);

      const degraded = await executeFragmentSlots({
        slots: [
          {
            name: "hero",
            fragment: "hero-fragment",
            dataDependencies: ["featured"],
          },
        ],
        registry: graphRegistry,
        ctx,
        fetchImpl: createOkFetch(),
        resolveData: failingResolver,
      });
      expect(degraded.health).toBe("degraded");
      expect(degraded.slots.hero.status).toBe("skipped-dependency");
    });

    it("fails data nodes when no resolver is configured", async () => {
      const execution = await executeFragmentSlots({
        slots: [
          {
            name: "hero",
            fragment: "hero-fragment",
            dataDependencies: ["featured"],
          },
        ],
        registry: graphRegistry,
        ctx,
        fetchImpl: createOkFetch(),
      });
      expect(execution.data.featured.status).toBe("error");
      expect(execution.data.featured.error).toContain("resolveData");
      expect(execution.slots.hero.status).toBe("skipped-dependency");
    });

    it("propagates failures through data-to-data dependencies", async () => {
      const execution = await executeFragmentSlots({
        slots: [
          {
            name: "hero",
            fragment: "hero-fragment",
            dataDependencies: ["derived"],
          },
        ],
        registry: graphRegistry,
        ctx,
        fetchImpl: createOkFetch(),
        resolveData: async (id: string) => {
          if (id === "base") throw new Error("base down");
          return id;
        },
        dataDependencies: [
          { id: "base" },
          { id: "derived", dependsOn: ["base"] },
        ],
      });
      expect(execution.data.base.status).toBe("error");
      expect(execution.data.derived.status).toBe("skipped-dependency");
      expect(execution.slots.hero.status).toBe("skipped-dependency");
    });

    it("plans mixed slot and data graphs and detects mixed cycles", () => {
      const plan = createSlotDataExecutionPlan({
        slots: [
          {
            name: "hero",
            fragment: "hero-fragment",
            dataDependencies: ["featured"],
          },
          { name: "promo", fragment: "promo-fragment" },
        ],
        dataDependencies: [{ id: "featured" }],
      });
      expect(
        plan.levels.map((level) => level.map((node) => node.key).sort()),
      ).toEqual([["data:featured", "slot:promo"], ["slot:hero"]]);

      expect(() =>
        createSlotDataExecutionPlan({
          slots: [],
          dataDependencies: [
            { id: "a", dependsOn: ["b"] },
            { id: "b", dependsOn: ["a"] },
          ],
        }),
      ).toThrow("dependency cycle");

      expect(() =>
        createSlotDataExecutionPlan({
          slots: [],
          dataDependencies: [{ id: "a", dependsOn: ["ghost"] }],
        }),
      ).toThrow('missing data "ghost"');

      expect(() =>
        createSlotDataExecutionPlan({
          slots: [],
          dataDependencies: [{ id: "a" }, { id: "a" }],
        }),
      ).toThrow('duplicate data dependency "a"');
    });

    it("emits a long-serial-chain hint only above the level threshold", () => {
      const chain: FragmentSlotDefinition[] = [
        { name: "a", fragment: "a" },
        { name: "b", fragment: "b", dependsOn: ["a"] },
        { name: "c", fragment: "c", dependsOn: ["b"] },
        { name: "d", fragment: "d", dependsOn: ["c"] },
      ];
      const plan = createSlotDataExecutionPlan({ slots: chain });
      const hint = plan.hints.find(
        (candidate) => candidate.kind === "long-serial-chain",
      );
      expect(hint).toBeDefined();
      expect(hint?.slots).toEqual(["a", "b", "c", "d"]);
      expect(
        createSlotDataExecutionPlan({ slots: chain, maxSerialLevels: 10 })
          .hints,
      ).toEqual([]);
    });

    it("emits an unnecessary-barrier hint only when a slot waits on unrelated nodes", () => {
      const plan = createSlotDataExecutionPlan({
        slots: [
          { name: "a", fragment: "a" },
          { name: "b", fragment: "b" },
          { name: "c", fragment: "c", dependsOn: ["a"] },
        ],
      });
      const hint = plan.hints.find(
        (candidate) => candidate.kind === "unnecessary-barrier",
      );
      expect(hint).toBeDefined();
      expect(hint?.slots).toContain("c");
      expect(hint?.slots).toContain("b");
      expect(hint?.message).toContain('"c"');

      const chainPlan = createSlotDataExecutionPlan({
        slots: [
          { name: "a", fragment: "a" },
          { name: "b", fragment: "b", dependsOn: ["a"] },
        ],
      });
      expect(
        chainPlan.hints.filter(
          (candidate) => candidate.kind === "unnecessary-barrier",
        ),
      ).toEqual([]);
    });

    it("emits a duplicate-data-resolution hint when a data key spans levels", () => {
      const plan = createSlotDataExecutionPlan({
        slots: [
          { name: "x", fragment: "x", dataDependencies: ["d"] },
          {
            name: "y",
            fragment: "y",
            dependsOn: ["x"],
            dataDependencies: ["d"],
          },
        ],
      });
      const hint = plan.hints.find(
        (candidate) => candidate.kind === "duplicate-data-resolution",
      );
      expect(hint).toBeDefined();
      expect(hint?.data).toEqual(["d"]);
      expect(hint?.slots.sort()).toEqual(["x", "y"]);

      const sameLevelPlan = createSlotDataExecutionPlan({
        slots: [
          { name: "x", fragment: "x", dataDependencies: ["d"] },
          { name: "y", fragment: "y", dataDependencies: ["d"] },
        ],
      });
      expect(
        sameLevelPlan.hints.filter(
          (candidate) => candidate.kind === "duplicate-data-resolution",
        ),
      ).toEqual([]);
    });

    it("writes scheduler hints and health into the trace", async () => {
      const trace = createRequestTrace({
        traceId: ctx.traceId,
        requestId: ctx.requestId,
      });
      const execution = await executeFragmentSlots({
        slots: [
          { name: "hero", fragment: "hero-fragment" },
          { name: "promo", fragment: "promo-fragment" },
          {
            name: "details",
            fragment: "details-fragment",
            dependsOn: ["hero"],
          },
        ],
        registry: graphRegistry,
        ctx,
        fetchImpl: createOkFetch(),
        trace,
      });
      expect(
        execution.hints.some(
          (candidate) => candidate.kind === "unnecessary-barrier",
        ),
      ).toBe(true);
      const snapshot = trace.toJSON();
      const scheduler = snapshot.nodes.find(
        (node) => node.name === "runtime.fetchFragmentSlots",
      );
      expect(scheduler?.attributes.health).toBe("ok");
      const tracedHints = scheduler?.attributes.schedulerHints as
        | SchedulerHint[]
        | undefined;
      expect(
        tracedHints?.some(
          (candidate) => candidate.kind === "unnecessary-barrier",
        ),
      ).toBe(true);
    });

    it("keeps fetchFragmentSlots backward compatible while exposing status", async () => {
      const record = await fetchFragmentSlots({
        slots: [{ name: "promo", fragment: "promo-fragment" }],
        registry: graphRegistry,
        ctx,
        fetchImpl: createOkFetch(),
      });
      expect(record.promo.source).toBe("network");
      expect(record.promo.status).toBe("ok");
    });
  });

  describe("fallback contract metadata", () => {
    it("marks createFallbackResponse with metadata.fallback = true", () => {
      const response = createFallbackResponse("promotion-banner");
      expect(response.metadata.fallback).toBe(true);
      expect(isFallbackResponse(response)).toBe(true);
    });

    it("detects fallback via metadata even without the legacy HTML marker", async () => {
      const fetchImpl = vi.fn(async () =>
        Response.json({
          html: "<section>degraded but unmarked html</section>",
          assets: { js: [], css: [] },
          cache: { ttl: 60, tags: [] },
          metadata: {
            name: "promotion-banner",
            version: "0.1.0",
            fallback: true,
          },
        }),
      ) as unknown as typeof fetch;
      const cache = new Map();
      const record = await fetchFragmentSlots({
        slots: [
          {
            name: "promo",
            fragment: "promotion-banner",
            strategy: "cached-ssr",
          },
        ],
        registry,
        ctx,
        fetchImpl,
        cache,
      });
      expect(record.promo.source).toBe("fallback");
      expect(record.promo.status).toBe("fallback");
      // Fallback responses must never be cached.
      expect(cache.size).toBe(0);
    });

    it("keeps the deprecated HTML sniff for fragments without metadata", () => {
      expect(
        isFallbackResponse({
          html: '<section data-fallback="true">legacy</section>',
          assets: { js: [], css: [] },
          cache: { ttl: 0, tags: [] },
          metadata: { name: "legacy", version: "0.1.0" },
        }),
      ).toBe(true);
      expect(
        isFallbackResponse({
          html: "<section>ok</section>",
          assets: { js: [], css: [] },
          cache: { ttl: 60, tags: [] },
          metadata: { name: "ok", version: "0.1.0" },
        }),
      ).toBe(false);
    });
  });

  describe("strategy normalization", () => {
    it("exports dynamic-ssr as the default render strategy", () => {
      expect(DEFAULT_RENDER_STRATEGY).toBe("dynamic-ssr");
    });

    it("caches ttl-cache slots across requests", async () => {
      const fetchImpl = vi.fn(async () =>
        Response.json({
          html: '<section data-fragment="promotion-banner">promo</section>',
          assets: { js: [], css: [] },
          cache: { ttl: 60, tags: [] },
          metadata: { name: "promotion-banner", version: "0.1.0" },
        }),
      ) as unknown as typeof fetch;
      const cache = new Map();
      const slots: FragmentSlotDefinition[] = [
        { name: "promo", fragment: "promotion-banner", strategy: "ttl-cache" },
      ];
      const first = await fetchFragmentSlots({
        slots,
        registry,
        ctx,
        fetchImpl,
        cache,
      });
      const second = await fetchFragmentSlots({
        slots,
        registry,
        ctx,
        fetchImpl,
        cache,
      });
      expect(first.promo.source).toBe("network");
      expect(first.promo.strategy).toBe("ttl-cache");
      expect(second.promo.source).toBe("cache");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  it("types slot channel as a release channel from contracts", () => {
    const slot: FragmentSlotDefinition = {
      name: "promo",
      fragment: "promotion-banner",
      channel: "canary",
    };
    const channel: ReleaseChannel | undefined = slot.channel;
    expect(channel).toBe("canary");
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

// Refactor plan §4.4 gate: prove `streamFragmentSlots` genuinely exposes
// out-of-order resolution — a fast slot's promise settles before a
// deliberately delayed slow slot's promise, using real timers and elapsed
// wall-clock time (not just "the code compiles and both eventually
// resolve"). This is the mechanism `<FragmentSlotStream>` + `<Suspense>`
// build on: a Suspense boundary streams the instant its own promise settles,
// so if the underlying promise here settles independently and early, the
// composed page does too.
describe("streamFragmentSlots streaming order", () => {
  const streamRegistry: FragmentRegistry = {
    fragments: {
      "fast-fragment": {
        stable: {
          version: "0.1.0",
          serviceUrl: "http://localhost:5301",
          manifestUrl: "http://localhost:5301/manifest",
        },
      },
      "slow-fragment": {
        stable: {
          version: "0.1.0",
          serviceUrl: "http://localhost:5302",
          manifestUrl: "http://localhost:5302/manifest",
        },
      },
    },
  };

  const SLOW_DELAY_MS = 150;

  function delayedFetchImpl(): typeof fetch {
    return (async (url: string | URL | Request) => {
      const isSlow = String(url).includes("5302");
      const name = isSlow ? "slow-fragment" : "fast-fragment";
      const body = JSON.stringify({
        html: `<section data-fragment="${name}">${name} live</section>`,
        assets: { js: [], css: [] },
        cache: { ttl: 0, tags: [name] },
        metadata: { name, version: "0.1.0" },
      });
      if (isSlow) {
        await new Promise((resolve) => setTimeout(resolve, SLOW_DELAY_MS));
      }
      return new Response(body);
    }) as unknown as typeof fetch;
  }

  it("returns immediately (synchronously) with a promise per slot, before either fetch settles", () => {
    const start = Date.now();
    const stream = streamFragmentSlots({
      registry: streamRegistry,
      ctx,
      fetchImpl: delayedFetchImpl(),
      timeoutMs: 1000,
      slots: [
        { name: "fast", fragment: "fast-fragment", strategy: "dynamic-ssr" },
        { name: "slow", fragment: "slow-fragment", strategy: "dynamic-ssr" },
      ],
    });

    // The call above must not have awaited anything: it hands back promise
    // objects, not resolved values, and does so well under the slow
    // fragment's artificial delay.
    expect(Date.now() - start).toBeLessThan(SLOW_DELAY_MS / 2);
    expect(stream.slots.fast).toBeInstanceOf(Promise);
    expect(stream.slots.slow).toBeInstanceOf(Promise);
    expect(stream.result).toBeInstanceOf(Promise);
  });

  it("resolves the fast slot's promise strictly before the slow slot's promise settles", async () => {
    const start = Date.now();
    const settledAt: Record<string, number> = {};

    const stream = streamFragmentSlots({
      registry: streamRegistry,
      ctx,
      fetchImpl: delayedFetchImpl(),
      timeoutMs: 1000,
      slots: [
        { name: "fast", fragment: "fast-fragment", strategy: "dynamic-ssr" },
        { name: "slow", fragment: "slow-fragment", strategy: "dynamic-ssr" },
      ],
    });

    stream.slots.fast.then(() => {
      settledAt.fast = Date.now() - start;
    });
    stream.slots.slow.then(() => {
      settledAt.slow = Date.now() - start;
    });

    // Race the fast slot's own promise against a timer set to well under the
    // slow fragment's artificial delay: if `streamFragmentSlots` only ever
    // resolved everything together (the old barrier behavior), this would
    // observe "timeout" instead of "fast", because nothing would settle
    // until the slow fetch also finished.
    const raceResult = await Promise.race([
      stream.slots.fast.then(() => "fast"),
      new Promise((resolve) =>
        setTimeout(() => resolve("timeout"), SLOW_DELAY_MS / 2),
      ),
    ]);
    expect(raceResult).toBe("fast");

    // At the moment the fast slot resolved, the slow slot must still be
    // pending — genuine out-of-order arrival, not a coincidence of ordering
    // within one microtask queue flush.
    expect(settledAt.slow).toBeUndefined();

    const fastResponse = await stream.slots.fast;
    expect(fastResponse.html).toContain("fast-fragment live");

    const slowResponse = await stream.slots.slow;
    expect(slowResponse.html).toContain("slow-fragment live");

    expect(settledAt.fast).toBeLessThan(SLOW_DELAY_MS / 2);
    expect(settledAt.slow).toBeGreaterThanOrEqual(SLOW_DELAY_MS - 20);
    expect(settledAt.fast).toBeLessThan(settledAt.slow);
  });

  it("only resolves the full aggregate once the slowest slot is done", async () => {
    const start = Date.now();
    const stream = streamFragmentSlots({
      registry: streamRegistry,
      ctx,
      fetchImpl: delayedFetchImpl(),
      timeoutMs: 1000,
      slots: [
        { name: "fast", fragment: "fast-fragment", strategy: "dynamic-ssr" },
        { name: "slow", fragment: "slow-fragment", strategy: "dynamic-ssr" },
      ],
    });

    const execution = await stream.result;
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(SLOW_DELAY_MS - 20);
    expect(execution.slots.fast.status).toBe("ok");
    expect(execution.slots.slow.status).toBe("ok");
    expect(execution.health).toBe("ok");
  });

  it("executeFragmentSlots stays behaviorally identical when built on streamFragmentSlots", async () => {
    const slots: FragmentSlotDefinition[] = [
      { name: "fast", fragment: "fast-fragment", strategy: "dynamic-ssr" },
      { name: "slow", fragment: "slow-fragment", strategy: "dynamic-ssr" },
    ];
    const execution = await executeFragmentSlots({
      registry: streamRegistry,
      ctx,
      fetchImpl: delayedFetchImpl(),
      timeoutMs: 1000,
      slots,
    });
    expect(execution.slots.fast.response.html).toContain("fast-fragment live");
    expect(execution.slots.slow.response.html).toContain("slow-fragment live");
    expect(execution.health).toBe("ok");
  });
});

describe("page wrapper helpers", () => {
  function makeSlotResult(
    overrides: Partial<FragmentSlotResult> & { name: string },
  ): FragmentSlotResult {
    const { name, ...rest } = overrides;
    return {
      slot: rest.slot ?? { name, fragment: `${name}-fragment` },
      strategy: "dynamic-ssr",
      source: "network",
      status: "ok",
      response: {
        html: `<section>${name} live</section>`,
        assets: { js: [], css: [] },
        cache: { ttl: 0, tags: [name] },
        metadata: { name: `${name}-fragment`, version: "0.1.0" },
      },
      ...rest,
    };
  }

  describe("applySlotRequestOverrides", () => {
    const generated: FragmentSlotDefinition[] = [
      {
        name: "editorial",
        fragment: "editorial",
        strategy: "static",
        staticHtml: "<p>static</p>",
      },
      { name: "promo", fragment: "promotion-banner", strategy: "dynamic-ssr" },
    ];

    it("merges the per-request timeout onto every non-static slot and leaves static slots untouched", () => {
      const slots = applySlotRequestOverrides(generated, { timeoutMs: 50 });
      // Static slots never fetch over the network, so they never carry a
      // timeout — the exact object reference passes through.
      expect(slots[0]).toBe(generated[0]);
      expect(slots[1]).toEqual({ ...generated[1], timeoutMs: 50 });
      // The generated array itself is never mutated.
      expect(generated[1].timeoutMs).toBeUndefined();
    });

    it("merges per-request props only when provided (page-trade's symbol pattern)", () => {
      const withProps = applySlotRequestOverrides(generated, {
        timeoutMs: 50,
        props: { symbol: "ETH" },
      });
      expect(withProps[1]).toEqual({
        ...generated[1],
        timeoutMs: 50,
        props: { symbol: "ETH" },
      });
      // No props override -> existing props survive the merge untouched.
      const existing: FragmentSlotDefinition[] = [
        { name: "promo", fragment: "promotion-banner", props: { a: 1 } },
      ];
      expect(applySlotRequestOverrides(existing, { timeoutMs: 50 })[0]).toEqual(
        {
          name: "promo",
          fragment: "promotion-banner",
          props: { a: 1 },
          timeoutMs: 50,
        },
      );
    });
  });

  describe("toSlotDiagnostic / collectSlotDiagnostics", () => {
    it("projects the diagnostic slice of a slot result (required defaults to false)", () => {
      const result = makeSlotResult({
        name: "promo",
        source: "fallback",
        status: "fallback",
      });
      expect(toSlotDiagnostic(result)).toEqual({
        source: "fallback",
        strategy: "dynamic-ssr",
        status: "fallback",
        required: false,
      });
      const required = makeSlotResult({
        name: "summary",
        slot: { name: "summary", fragment: "summary", required: true },
      });
      expect(toSlotDiagnostic(required).required).toBe(true);
    });

    it("assembles the per-slot diagnostics map keyed by slot name", () => {
      const slots = {
        promo: makeSlotResult({ name: "promo" }),
        summary: makeSlotResult({ name: "summary", source: "cache" }),
      };
      expect(collectSlotDiagnostics(slots)).toEqual({
        promo: toSlotDiagnostic(slots.promo),
        summary: toSlotDiagnostic(slots.summary),
      });
    });

    it("supports a page-specific projection (page-product's two-field diagnostics)", () => {
      const slots = { promo: makeSlotResult({ name: "promo" }) };
      const diagnostics = collectSlotDiagnostics(slots, (result) => ({
        source: result.source,
        strategy: result.strategy,
      }));
      expect(diagnostics).toEqual({
        promo: { source: "network", strategy: "dynamic-ssr" },
      });
    });
  });

  describe("resolveFragmentStream", () => {
    it("awaits every slot promise into the resolved-HTML map plus the aggregate and execution", async () => {
      const promoResult = makeSlotResult({ name: "promo" });
      const execution: FragmentSlotsExecution = {
        slots: { promo: promoResult },
        data: {},
        health: "ok",
        hints: [],
      };
      const aggregate = { traceLog: "trace" };
      const resolved = await resolveFragmentStream({
        slotPromises: { promo: Promise.resolve(promoResult.response) },
        execution: Promise.resolve(execution),
        aggregate: Promise.resolve(aggregate),
      });
      expect(resolved.html).toEqual({ promo: "<section>promo live</section>" });
      // The aggregate passes through with its page-specific type intact.
      expect(resolved.aggregate).toBe(aggregate);
      expect(resolved.execution).toBe(execution);
    });
  });
});
