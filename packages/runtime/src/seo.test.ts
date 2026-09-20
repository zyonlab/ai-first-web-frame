import { describe, expect, it, vi } from "vitest";
import {
  createPageMetadata,
  DEFAULT_SITE_ORIGIN,
  isDiagnosticsEnabled,
  resolveSiteOrigin,
} from "./seo";

describe("resolveSiteOrigin", () => {
  it("uses PUBLIC_SITE_ORIGIN when it is a valid URL", () => {
    expect(
      resolveSiteOrigin({ PUBLIC_SITE_ORIGIN: "https://perps.example/base" }),
    ).toBe("https://perps.example");
  });

  it("falls back loudly on a malformed override instead of emitting bad canonicals", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(resolveSiteOrigin({ PUBLIC_SITE_ORIGIN: "not-a-url" })).toBe(
        DEFAULT_SITE_ORIGIN,
      );
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it("falls back silently when the override is unset", () => {
    expect(resolveSiteOrigin({})).toBe(DEFAULT_SITE_ORIGIN);
  });
});

describe("createPageMetadata", () => {
  const metadata = createPageMetadata({
    title: "MVP Perps — Markets",
    description: "All markets.",
    path: "/markets",
    origin: "https://perps.example",
  });

  it("emits an absolute canonical for the public origin, not the page origin", () => {
    expect(metadata.alternates.canonical).toBe("https://perps.example/markets");
    expect(metadata.metadataBase.origin).toBe("https://perps.example");
  });

  it("emits hreflang alternates for every published locale plus x-default", () => {
    expect(Object.keys(metadata.alternates.languages).sort()).toEqual([
      "en-US",
      "x-default",
      "zh-CN",
    ]);
  });

  it("emits Open Graph and Twitter cards carrying the canonical URL", () => {
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      url: "https://perps.example/markets",
      siteName: "MVP Perps",
    });
    expect(metadata.twitter.card).toBe("summary_large_image");
  });

  it("marks user-private pages noindex", () => {
    const priv = createPageMetadata({
      title: "Portfolio",
      description: "Your positions.",
      path: "/portfolio",
      origin: "https://perps.example",
      noindex: true,
    });
    expect(priv.robots).toEqual({ index: false, follow: false });
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("keeps dynamic-segment paths verbatim in the canonical", () => {
    expect(
      createPageMetadata({
        title: "t",
        description: "d",
        path: "/product/123",
        origin: "https://perps.example",
      }).alternates.canonical,
    ).toBe("https://perps.example/product/123");
  });
});

describe("isDiagnosticsEnabled", () => {
  it("is off in production unless explicitly enabled", () => {
    expect(isDiagnosticsEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(
      isDiagnosticsEnabled({ NODE_ENV: "production", MVP_DIAGNOSTICS: "on" }),
    ).toBe(true);
  });

  it("is on outside production unless explicitly disabled", () => {
    expect(isDiagnosticsEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(isDiagnosticsEnabled({})).toBe(true);
    expect(isDiagnosticsEnabled({ MVP_DIAGNOSTICS: "off" })).toBe(false);
  });
});
