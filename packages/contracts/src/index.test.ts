import { describe, expect, it } from "vitest";
import {
  ApiEndpointPolicySchema,
  AssetManifestSchema,
  assertBudget,
  ComponentMetadataSchema,
  CookiePolicySchema,
  createBudgetReport,
  DataDependencySchema,
  FragmentManifestSchema,
  FragmentRegistrySchema,
  I18nManifestSchema,
  loadDefaultBudget,
  mergeBudget,
  OptimizationFindingSchema,
  PageManifestSchema,
  PerformanceBudgetSchema,
  ReleaseManifestSchema,
  RequestContextSchema,
  RequestPolicySchema,
  StoragePolicySchema,
  ThemeManifestSchema,
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
});
