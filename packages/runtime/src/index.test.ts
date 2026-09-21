import type {
  FragmentRegistry,
  ReleaseChannel,
  RequestContext,
  RouteManifest,
} from "@mvp/contracts";
import { createRequestTrace } from "@mvp/observability";
import { describe, expect, it, vi } from "vitest";
import {
  applySlotRequestOverrides,
  buildServerTiming,
  clearFragmentCache,
  collectSlotDiagnostics,
  createFallbackResponse,
  createFragmentCache,
  createFragmentCacheKey,
  createFragmentHeaders,
  createFragmentSlotExecutionPlan,
  createSlotDataExecutionPlan,
  DEFAULT_RENDER_STRATEGY,
  executeFragmentSlots,
  type FragmentSlotDefinition,
  type FragmentSlotResult,
  type FragmentSlotsExecution,
  failedRequiredSlotNames,
  fetchFragment,
  fetchFragmentSlots,
  formatServerTiming,
  invalidateFragmentCacheByTag,
  isFallbackResponse,
  mergeAssets,
  PAGE_HEALTH_ATTR,
  PAGE_HEALTH_FAILED_ATTR,
  PAGE_TIMING_ATTR,
  pruneFragmentCache,
  type RuntimeTrace,
  readPageHealthFromHtml,
  readServerTimingFromHtml,
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
  extensions: {},
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
          tags: [],
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

    it("does not read the marker out of the fragment's own stylesheet", () => {
      // The exact shape that made /markets answer 503 on every request:
      // markets-table inlines a rule that styles its degraded state, so the
      // marker string appeared in every healthy response. Kept after the sniff
      // was removed entirely, because it is the regression that must not return.
      expect(
        isFallbackResponse({
          html: [
            '<style data-fragment-style="markets-table">',
            '[data-fragment="markets-table"][data-fallback="true"] { opacity: 0.6; }',
            "</style>",
            '<section data-fragment="markets-table"><table></table></section>',
          ].join(""),
          assets: { js: [], css: [] },
          cache: { ttl: 5, tags: ["markets"] },
          metadata: { name: "markets-table", version: "0.1.0" },
        }),
      ).toBe(false);
    });

    it("classifies by metadata alone, not by the marker on real markup", () => {
      const html = [
        '<style>[data-fallback="true"] { color: red; }</style>',
        '<section data-fallback="true">Markets unavailable</section>',
      ].join("");
      // Same markup, two metadata values, two answers. The attribute is still
      // what CSS and the e2e specs read off the DOM; it is no longer what the
      // runtime classifies by, because a marker string can appear in any text a
      // fragment renders and a search over HTML cannot tell those apart.
      expect(
        isFallbackResponse({
          html,
          assets: { js: [], css: [] },
          cache: { ttl: 0, tags: [] },
          metadata: { name: "markets-table", version: "0.1.0" },
        }),
      ).toBe(false);
      expect(
        isFallbackResponse({
          html,
          assets: { js: [], css: [] },
          cache: { ttl: 0, tags: [] },
          metadata: {
            name: "markets-table",
            version: "0.1.0",
            fallback: true,
          },
        }),
      ).toBe(true);
    });

    it("no longer infers a fallback from markup alone", () => {
      // This is the removed behaviour, pinned inverted so it cannot creep back.
      // A fragment that renders the marker without setting `metadata.fallback`
      // now counts as live: the metadata flag is the contract, and an unmarked
      // degraded response is a fragment bug rather than something to guess at.
      expect(
        isFallbackResponse({
          html: '<section data-fallback="true">legacy</section>',
          assets: { js: [], css: [] },
          cache: { ttl: 0, tags: [] },
          metadata: { name: "legacy", version: "0.1.0" },
        }),
      ).toBe(false);
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

describe("degradation identity and cache bounds", () => {
  const ctx: RequestContext = {
    traceId: "trace-degrade",
    requestId: "req-degrade",
    locale: "en-US",
    tenant: "default",
    featureFlags: {},
    experiment: {},
    extensions: {},
    theme: "system",
    device: "desktop",
    userAgent: "vitest",
    timestamp: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  };
  const registry: FragmentRegistry = {
    fragments: {
      "promotion-banner": {
        stable: {
          version: "0.1.0",
          serviceUrl: "http://promotion-banner.internal:4201",
          manifestUrl: "http://promotion-banner.internal:4201/manifest",
        },
      },
    },
  };

  it("names a network-failure fallback by fragment name, never by serviceUrl", async () => {
    const execution = await executeFragmentSlots({
      slots: [
        {
          name: "promo",
          fragment: "promotion-banner",
          strategy: "dynamic-ssr",
        },
      ],
      registry,
      ctx,
      timeoutMs: 5,
      cache: createFragmentCache(),
      fetchImpl: vi.fn(async () => {
        throw new Error("upstream down");
      }) as unknown as typeof fetch,
    });
    const html = execution.slots.promo.response.html;
    expect(html).toContain('data-fragment="promotion-banner"');
    // The internal DNS name and port must never reach the public HTML.
    expect(html).not.toContain("promotion-banner.internal");
    expect(html).not.toContain("4201");
  });

  it("escapes markup in the fallback reason", () => {
    const html = createFallbackResponse(
      "promotion-banner",
      "0.1.0",
      '<script>alert("x")</script>',
    ).html;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("aborts the upstream request when the slot timeout fires", async () => {
    let observed: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          observed = init?.signal ?? undefined;
          observed?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    ) as unknown as typeof fetch;
    const response = await fetchFragment(
      {
        serviceUrl: "http://slow.internal:4201",
        version: "0.1.0",
        name: "promotion-banner",
      },
      { ctx, props: {} },
      { fetchImpl, timeoutMs: 5 },
    );
    expect(isFallbackResponse(response)).toBe(true);
    expect(observed?.aborted).toBe(true);
  });

  it("prunes expired entries and evicts oldest writes past the ceiling", () => {
    const cache = createFragmentCache();
    const entry = (expiresAt: number, tags: string[] = []) => ({
      expiresAt,
      tags,
      response: createFallbackResponse("x"),
    });
    cache.set("expired", entry(10));
    cache.set("a", entry(1_000));
    cache.set("b", entry(1_000));
    cache.set("c", entry(1_000));
    const removed = pruneFragmentCache(cache, 100, 2);
    expect(removed).toBe(2); // one expired + one oldest-write eviction
    expect(cache.has("expired")).toBe(false);
    expect(cache.has("a")).toBe(false);
    expect([...cache.keys()]).toEqual(["b", "c"]);
  });

  it("invalidates cached responses by declared cache tag", () => {
    const cache = createFragmentCache();
    const entry = (tags: string[]) => ({
      expiresAt: Number.MAX_SAFE_INTEGER,
      tags,
      response: createFallbackResponse("x"),
    });
    cache.set("k1", entry(["ticker", "trade"]));
    cache.set("k2", entry(["funding"]));
    expect(invalidateFragmentCacheByTag("ticker", cache)).toBe(1);
    expect([...cache.keys()]).toEqual(["k2"]);
    expect(invalidateFragmentCacheByTag("nope", cache)).toBe(0);
  });

  it("stores the slot's declared cache tags with the cached response", async () => {
    const cache = createFragmentCache();
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            html: "<section>live</section>",
            assets: { js: [], css: [] },
            cache: { ttl: 60, tags: ["from-response"] },
            metadata: { name: "promotion-banner", version: "0.1.0" },
          }),
        ),
    ) as unknown as typeof fetch;
    await executeFragmentSlots({
      slots: [
        {
          name: "promo",
          fragment: "promotion-banner",
          strategy: "cached-ssr",
          cachePolicy: { ttl: 60, tags: ["home", "promo"] },
        },
      ],
      registry,
      ctx,
      cache,
      fetchImpl,
      now: () => 0,
    });
    expect([...cache.values()][0].tags).toEqual(["home", "promo"]);
    expect(invalidateFragmentCacheByTag("promo", cache)).toBe(1);
  });
});

describe("page health signalling (Tailor's primary semantic)", () => {
  const slotResult = (
    name: string,
    required: boolean,
    status: "ok" | "fallback",
  ) => ({
    slot: { name, fragment: `${name}-fragment`, required },
    strategy: "dynamic-ssr" as const,
    source: status === "ok" ? ("network" as const) : ("fallback" as const),
    status,
    response: createFallbackResponse(name),
  });

  it("lists only the required slots that failed, sorted", () => {
    const execution = {
      slots: {
        a: slotResult("a", true, "fallback"),
        b: slotResult("b", false, "fallback"),
        c: slotResult("c", true, "ok"),
        d: slotResult("d", true, "fallback"),
      },
      data: {},
      health: "unhealthy" as const,
      hints: [],
    };
    expect(failedRequiredSlotNames(execution)).toEqual(["a", "d"]);
  });

  it("reads the health marker back out of composed HTML", () => {
    const html = `<!doctype html><html><body><div hidden ${PAGE_HEALTH_ATTR}="unhealthy" ${PAGE_HEALTH_FAILED_ATTR}="promotion,hero"></div></body></html>`;
    expect(readPageHealthFromHtml(html)).toEqual({
      health: "unhealthy",
      failedSlots: ["promotion", "hero"],
    });
  });

  it("treats a page with no marker as having no opinion", () => {
    expect(
      readPageHealthFromHtml("<html><body>plain</body></html>"),
    ).toBeNull();
  });

  it("ignores a marker carrying a value outside the health enum", () => {
    const html = `<div hidden ${PAGE_HEALTH_ATTR}="probably-fine"></div>`;
    expect(readPageHealthFromHtml(html)).toBeNull();
  });

  it("handles an empty failed-slot list", () => {
    const html = `<div hidden ${PAGE_HEALTH_ATTR}="degraded" ${PAGE_HEALTH_FAILED_ATTR}=""></div>`;
    expect(readPageHealthFromHtml(html)).toEqual({
      health: "degraded",
      failedSlots: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Server-Timing — the channel that puts server durations into the browser's
// own timeline. The grammar is unforgiving: one stray `;` or `,` in a name
// silently truncates every entry after it, so the escaping is the real test.
// ---------------------------------------------------------------------------

describe("formatServerTiming", () => {
  it("emits name, quoted desc and rounded dur", () => {
    expect(
      formatServerTiming([
        { name: "book", durationMs: 142.37, description: "network" },
      ]),
    ).toBe('book;desc="network";dur=142.4');
  });

  it("sanitises a name that would break the grammar", () => {
    // A slot name is authored data. Without this, `a;b` would read as an entry
    // named `a` with a bogus parameter, and everything after it would be lost.
    expect(formatServerTiming([{ name: "a;b,c", durationMs: 1 }])).toBe(
      "a_b_c;dur=1",
    );
  });

  it("strips quotes from a description rather than emitting them raw", () => {
    expect(
      formatServerTiming([{ name: "x", description: 'he said "hi"' }]),
    ).toBe('x;desc="he said hi"');
  });

  it("keeps an entry that has no duration", () => {
    expect(formatServerTiming([{ name: "x" }])).toBe("x");
  });

  it("joins entries with a comma", () => {
    expect(
      formatServerTiming([
        { name: "a", durationMs: 1 },
        { name: "b", durationMs: 2 },
      ]),
    ).toBe("a;dur=1, b;dur=2");
  });
});

describe("buildServerTiming", () => {
  it("carries the source as desc, so a 2ms slot is readable as a cache hit", () => {
    const slots = {
      book: {
        slot: { name: "book", fragment: "order-book" },
        strategy: "dynamic-ssr",
        source: "cache",
        status: "ok",
        response: {} as never,
        durationMs: 2,
      },
      orderForm: {
        slot: { name: "orderForm", fragment: "order-form" },
        strategy: "dynamic-ssr",
        source: "network",
        status: "ok",
        response: {} as never,
        durationMs: 88.4,
      },
    } as unknown as Record<string, FragmentSlotResult>;
    expect(buildServerTiming(slots)).toBe(
      'book;desc="cache";dur=2, orderForm;desc="network";dur=88.4',
    );
  });
});

describe("readServerTimingFromHtml", () => {
  it("reads the marker back out of composed markup", () => {
    const html = `<main>x</main><div hidden ${PAGE_TIMING_ATTR}="book;dur=1"></div>`;
    expect(readServerTimingFromHtml(html)).toBe("book;dur=1");
  });

  it("undoes the entity escaping React applies to the attribute", () => {
    // React serialises `desc="network"` as `desc=&quot;network&quot;`; handing
    // that to the header verbatim would emit literal entities.
    const html = `<div hidden ${PAGE_TIMING_ATTR}="book;desc=&quot;cache&quot;;dur=2"></div>`;
    expect(readServerTimingFromHtml(html)).toBe('book;desc="cache";dur=2');
  });

  it("returns null for a page that does not participate", () => {
    expect(readServerTimingFromHtml("<main>no marker</main>")).toBeNull();
  });
});
