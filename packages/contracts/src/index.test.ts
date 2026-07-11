import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ApiEndpointPolicySchema,
  AssetManifestSchema,
  assertBudget,
  ComponentMetadataSchema,
  CookiePolicySchema,
  createBudgetReport,
  DataDependencySchema,
  FragmentManifestJsonSchema,
  FragmentManifestSchema,
  FragmentRegistryJsonSchema,
  FragmentRegistrySchema,
  FragmentRenderRequestJsonSchema,
  FragmentRenderResponseJsonSchema,
  FragmentRenderResponseSchema,
  I18nManifestSchema,
  loadDefaultBudget,
  mergeBudget,
  OptimizationFindingSchema,
  PageManifestJsonSchema,
  PageManifestSchema,
  PerformanceBudgetSchema,
  parseFragmentRenderRequest,
  parseFragmentRenderResponse,
  ReleaseManifestSchema,
  RenderStrategySchema,
  RequestContextJsonSchema,
  RequestContextSchema,
  RequestPolicySchema,
  StoragePolicySchema,
  ThemeManifestSchema,
  toJsonSchema,
  WorkerManifestSchema,
} from "./index";

const ctx = {
  traceId: "trace-123456",
  requestId: "req-1234",
  locale: "en-US",
  tenant: "default",
  featureFlags: {},
  experiment: {},
  theme: "system",
  device: "desktop",
  userAgent: "vitest",
  timestamp: new Date("2026-01-01T00:00:00.000Z").toISOString(),
};

describe("@mvp/contracts", () => {
  it("parses valid RequestContext and rejects invalid context", () => {
    expect(RequestContextSchema.parse(ctx).traceId).toBe("trace-123456");
    expect(() => RequestContextSchema.parse({ ...ctx, traceId: "" })).toThrow();
  });

  it("parses valid ComponentMetadata and rejects invalid metadata", () => {
    const metadata = {
      name: "Button",
      version: "0.1.0",
      owner: "platform",
      category: "ui",
      serverSafe: true,
      propsSchema: {},
      description: "Action",
    };
    expect(ComponentMetadataSchema.parse(metadata).serverSafe).toBe(true);
    expect(() =>
      ComponentMetadataSchema.parse({ ...metadata, owner: "" }),
    ).toThrow();
  });

  it("requires FragmentManifest owner/version/renderMode/fallback/assets/budget", () => {
    const manifest = {
      name: "promotion-banner",
      version: "0.1.0",
      owner: "growth",
      renderMode: "ssr",
      fallback: "<section>Fallback</section>",
      assets: { js: [], css: [] },
      budget: loadDefaultBudget("fragment", "promotion-banner"),
    };
    expect(FragmentManifestSchema.parse(manifest).name).toBe(
      "promotion-banner",
    );
    for (const key of [
      "owner",
      "version",
      "renderMode",
      "fallback",
      "assets",
      "budget",
    ]) {
      const copy = { ...manifest } as Record<string, unknown>;
      delete copy[key];
      expect(() => FragmentManifestSchema.parse(copy)).toThrow();
    }
  });

  it("requires PageManifest route/renderMode/seo/budget/slots", () => {
    const manifest = {
      name: "home",
      route: "/",
      renderMode: "ssr",
      seo: { title: "Home", description: "Home page" },
      budget: loadDefaultBudget("page", "home"),
      slots: [{ name: "hero", fragment: "promotion-banner", required: false }],
    };
    expect(PageManifestSchema.parse(manifest).route).toBe("/");
    for (const key of ["route", "renderMode", "seo", "budget", "slots"]) {
      const copy = { ...manifest } as Record<string, unknown>;
      delete copy[key];
      expect(() => PageManifestSchema.parse(copy)).toThrow();
    }
  });

  it("PageManifest.demonstrates is optional, additive, and validated when present", () => {
    const manifest = {
      name: "home",
      route: "/",
      renderMode: "ssr",
      seo: { title: "Home", description: "Home page" },
      budget: loadDefaultBudget("page", "home"),
      slots: [{ name: "hero", fragment: "promotion-banner", required: false }],
    };
    // Omitted entirely: still parses (backward compatible with every
    // pre-existing manifest that predates the field).
    expect(PageManifestSchema.parse(manifest).demonstrates).toBeUndefined();

    // Present: parses through and preserves the capability list.
    const withDemonstrates = {
      ...manifest,
      demonstrates: ["fallback-isolation", "trace-panel"],
    };
    expect(PageManifestSchema.parse(withDemonstrates).demonstrates).toEqual([
      "fallback-isolation",
      "trace-panel",
    ]);

    // Present but wrong element type: rejected like every other typed array.
    expect(() =>
      PageManifestSchema.parse({ ...manifest, demonstrates: [42] }),
    ).toThrow();
  });

  it("supports four performance budget scopes and reporting", () => {
    for (const scope of ["component", "fragment", "page", "shell"] as const) {
      expect(
        PerformanceBudgetSchema.parse(loadDefaultBudget(scope, scope)).scope,
      ).toBe(scope);
    }
    const budget = mergeBudget(loadDefaultBudget("component", "Button"), {
      jsBytes: 100,
    });
    expect(assertBudget({ jsBytes: 101 }, budget).ok).toBe(false);
    expect(createBudgetReport({ jsBytes: 99 }, budget).status).toBe("passed");
  });

  it("supports stable/canary/preview/explicit fragment versions", () => {
    const registry = FragmentRegistrySchema.parse({
      fragments: {
        "promotion-banner": {
          stable: {
            version: "0.1.0",
            serviceUrl: "http://localhost:4201",
            manifestUrl: "http://localhost:4201/manifest",
          },
          canary: {
            version: "0.2.0-beta.1",
            serviceUrl: "http://localhost:4201",
            manifestUrl: "http://localhost:4201/manifest",
          },
          preview: {
            version: "0.2.0-preview.1",
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
    });
    expect(registry.fragments["promotion-banner"].stable?.version).toBe(
      "0.1.0",
    );
  });

  it("validates production-ready data dependency policies", () => {
    expect(
      DataDependencySchema.parse({
        id: "product",
        owner: "page",
        source: "api",
        freshness: "isr",
        privacy: "public",
        cachePolicy: { ttl: 300, tags: ["product"] },
      }).freshness,
    ).toBe("isr");
    expect(() =>
      DataDependencySchema.parse({
        id: "private-static",
        owner: "fragment",
        source: "api",
        freshness: "static",
        privacy: "user-private",
      }),
    ).toThrow("user-private data cannot be static");
    expect(() =>
      DataDependencySchema.parse({
        id: "ticker",
        owner: "client-island",
        source: "subscription",
        freshness: "near-realtime",
        privacy: "public",
      }),
    ).toThrow("subscription sources must be realtime");
  });

  it("validates asset font theme and i18n manifests", () => {
    const assets = AssetManifestSchema.parse({
      css: [{ href: "/global.css", scope: "global", priority: 1 }],
      js: [
        {
          href: "/island.js",
          scope: "client-island",
          strategy: "island",
          integrity: "sha384-test",
        },
      ],
      fonts: [{ family: "Inter", href: "/inter.woff2", preload: true }],
    });
    expect(assets.css[0].scope).toBe("global");
    expect(assets.js[0].strategy).toBe("island");
    expect(
      ThemeManifestSchema.parse({
        tokenVersion: "2026.07",
        supportedThemes: ["light", "dark", "system"],
      }).defaultTheme,
    ).toBe("system");
    expect(
      I18nManifestSchema.parse({
        namespaces: ["common"],
        locales: ["en-US", "zh-CN"],
        fallbackLocale: "en-US",
        version: "1",
      }).locales,
    ).toContain("zh-CN");
  });

  it("validates request storage cookie worker release and optimization contracts", () => {
    expect(
      ApiEndpointPolicySchema.parse({
        id: "catalog",
        baseUrl: "https://api.example.test/catalog",
      }).allowedMethods,
    ).toEqual(["GET"]);
    expect(
      RequestPolicySchema.parse({
        endpoints: [
          { id: "catalog", baseUrl: "https://api.example.test/catalog" },
        ],
      }).defaultTimeoutMs,
    ).toBe(500);
    expect(() =>
      StoragePolicySchema.parse({
        id: "private-cache",
        adapter: "indexed-db",
        privacy: "user-private",
        partitionBy: ["tenant"],
      }),
    ).toThrow("user-private storage must partition by user");
    expect(CookiePolicySchema.parse({ name: "mvp_session" }).sameSite).toBe(
      "lax",
    );
    expect(
      WorkerManifestSchema.parse({
        id: "offline",
        kind: "service-worker",
        scope: "/",
      }).privacy,
    ).toBe("public");
    expect(
      ReleaseManifestSchema.parse({
        unit: "fragment",
        name: "promotion-banner",
        version: "0.1.0",
        channel: "stable",
      }).unit,
    ).toBe("fragment");
    expect(
      OptimizationFindingSchema.parse({
        id: "finding-1",
        severity: "medium",
        category: "network",
        message: "duplicate request",
        target: "page-home",
        recommendation: "dedupe through @mvp/data",
      }).category,
    ).toBe("network");
  });

  it("accepts ttl-cache and rejects the retired isr slot-strategy alias", () => {
    expect(RenderStrategySchema.parse("ttl-cache")).toBe("ttl-cache");
    expect(RenderStrategySchema.parse("cached-ssr")).toBe("cached-ssr");
    expect(RenderStrategySchema.parse("dynamic-ssr")).toBe("dynamic-ssr");
    expect(RenderStrategySchema.parse("static")).toBe("static");
    // The deprecation window closed: "isr" as a SLOT strategy is gone (it
    // collided with Next.js ISR, goal A4). The unrelated "isr" members of
    // PageManifestSchema.renderMode and DataFreshnessSchema mean actual
    // Next.js ISR and stay.
    expect(() => RenderStrategySchema.parse("isr")).toThrow();
  });

  it("marks fallback render responses via metadata.fallback", () => {
    const response = {
      html: "<section>ok</section>",
      assets: { js: [], css: [] },
      cache: { ttl: 0, tags: [] },
      metadata: { name: "promotion-banner", version: "0.1.0" },
    };
    // Absent flag = not a fallback (backwards compatible).
    expect(
      FragmentRenderResponseSchema.parse(response).metadata.fallback,
    ).toBeUndefined();
    expect(
      FragmentRenderResponseSchema.parse({
        ...response,
        metadata: { ...response.metadata, fallback: true },
      }).metadata.fallback,
    ).toBe(true);
    expect(() =>
      FragmentRenderResponseSchema.parse({
        ...response,
        metadata: { ...response.metadata, fallback: "yes" },
      }),
    ).toThrow();
  });

  it("parses well-formed /render bodies strictly and adapts partial envelopes", () => {
    const strict = parseFragmentRenderRequest({
      ctx,
      props: { scene: "home" },
    });
    expect(strict.ok).toBe(true);
    if (strict.ok) {
      expect(strict.strict).toBe(true);
      expect(strict.request.props).toEqual({ scene: "home" });
    }

    // Partial envelopes (missing props / subset ctx) are adapted, not rejected:
    // fragments own graceful degradation for missing props.
    for (const body of [
      {},
      { props: { scene: "home" } },
      { ctx: {} },
      { ctx: { locale: "en-US", traceId: "e2e-trace" } },
      undefined,
    ]) {
      const lenient = parseFragmentRenderRequest(body);
      expect(lenient.ok).toBe(true);
      if (lenient.ok) expect(lenient.strict).toBe(false);
    }
  });

  it("rejects malformed /render envelopes with schema-naming issues", () => {
    for (const body of [
      { ctx: "nope" },
      { props: 42 },
      [],
      "html",
      { ctx: { locale: 5 } },
    ]) {
      const parsed = parseFragmentRenderRequest(body);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.issues.length).toBeGreaterThan(0);
    }
  });

  it("validates /render response bodies at the consuming edge", () => {
    const response = {
      html: "<section>ok</section>",
      assets: { js: [], css: [] },
      cache: { ttl: 0, tags: [] },
      metadata: { name: "promotion-banner", version: "0.1.0" },
    };
    const parsed = parseFragmentRenderResponse(response);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.response.html).toBe(response.html);

    // No lenient tier: a structurally malformed response is rejected with
    // issues naming the contract, so the runtime can degrade it loudly.
    for (const body of [
      null,
      "html",
      { html: 42 },
      { ...response, assets: { js: "not-a-list", css: [] } },
      { ...response, cache: { ttl: -1, tags: [] } },
      { ...response, metadata: { name: "x" } },
    ]) {
      const bad = parseFragmentRenderResponse(body);
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.issues.length).toBeGreaterThan(0);
    }
  });

  // §2.3 "npm distribution shape": non-TS agents validate against generated
  // JSON Schema, not just the Zod schemas TypeScript consumers use.
  describe("toJsonSchema", () => {
    it("produces a parseable JSON Schema document for an arbitrary schema", () => {
      const schema = z.object({ name: z.string(), count: z.number() });
      const json = toJsonSchema(schema, "Simple");
      // Round-trips through JSON (proves it's plain-serializable, not a
      // class instance or something with cycles/functions on it).
      const roundTripped = JSON.parse(JSON.stringify(json));
      expect(roundTripped).toBeTypeOf("object");
      // Named schemas are emitted as a $ref into `definitions`.
      expect(roundTripped.$ref).toBe("#/definitions/Simple");
      expect(roundTripped.definitions.Simple.type).toBe("object");
      expect(roundTripped.definitions.Simple.properties).toHaveProperty("name");
      expect(roundTripped.definitions.Simple.properties).toHaveProperty(
        "count",
      );
    });

    it("produces a schema-shaped object (no name) with a type/properties field", () => {
      const schema = z.object({ ok: z.boolean() });
      const json = toJsonSchema(schema) as Record<string, unknown>;
      expect(json.type).toBe("object");
      expect(json.properties).toHaveProperty("ok");
    });

    it.each([
      ["FragmentManifestJsonSchema", FragmentManifestJsonSchema],
      ["PageManifestJsonSchema", PageManifestJsonSchema],
      ["FragmentRegistryJsonSchema", FragmentRegistryJsonSchema],
      ["FragmentRenderRequestJsonSchema", FragmentRenderRequestJsonSchema],
      ["FragmentRenderResponseJsonSchema", FragmentRenderResponseJsonSchema],
      ["RequestContextJsonSchema", RequestContextJsonSchema],
    ])("%s is a ready-made, JSON-serializable JSON Schema with a $ref + definitions entry", (name, jsonSchema) => {
      const roundTripped = JSON.parse(JSON.stringify(jsonSchema));
      expect(roundTripped).toBeTypeOf("object");
      expect(typeof roundTripped.$ref).toBe("string");
      expect(roundTripped.$ref).toMatch(/^#\/definitions\//);
      const definitionName = roundTripped.$ref.replace("#/definitions/", "");
      expect(roundTripped.definitions).toHaveProperty(definitionName);
      expect(roundTripped.definitions[definitionName].type).toBe("object");
      expect(name).toBeTruthy();
    });
  });
});
