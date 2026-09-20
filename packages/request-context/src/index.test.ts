import { describe, expect, it } from "vitest";
import {
  createRequestContext,
  deserializeContext,
  getContextExtension,
  getFeatureFlags,
  getLocale,
  getTenant,
  getTraceId,
  serializeContext,
} from "./index";

describe("@mvp/request-context", () => {
  it("creates default context without headers", () => {
    const ctx = createRequestContext();
    expect(ctx.locale).toBe("en-US");
    expect(ctx.tenant).toBe("default");
    expect(ctx.traceId).toMatch(/^trace-/);
  });

  it("parses locale tenant and trace headers", () => {
    const ctx = createRequestContext({
      headers: {
        "x-locale": "zh-CN",
        "x-tenant": "acme",
        "x-trace-id": "trace-fixed-123",
        "x-flags": "newHero=true,limit=3",
      },
    });
    expect(getLocale(ctx)).toBe("zh-CN");
    expect(getTenant(ctx)).toBe("acme");
    expect(getTraceId(ctx)).toBe("trace-fixed-123");
    expect(getFeatureFlags(ctx).limit).toBe(3);
  });

  it("freezes context deeply", () => {
    const ctx = createRequestContext({ headers: { "x-flags": "a=true" } });
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.featureFlags)).toBe(true);
  });

  it("serializes and deserializes core fields", () => {
    const ctx = createRequestContext({
      headers: {
        "x-locale": "fr-FR",
        "x-tenant": "store",
        "x-trace-id": "trace-serialize",
      },
    });
    const restored = deserializeContext(serializeContext(ctx));
    expect(restored.traceId).toBe("trace-serialize");
    expect(restored.locale).toBe("fr-FR");
    expect(restored.tenant).toBe("store");
  });
});

describe("context extensions (open dimension slot)", () => {
  it("resolves declared parsers into ctx.extensions and omits undefined ones", () => {
    const ctx = createRequestContext({
      headers: { "x-ab-bucket": "B", "x-trace-id": "trace-extensions-1" },
      extensions: {
        // A business dimension the framework knows nothing about.
        abBucket: (read) => read("x-ab-bucket"),
        channel: (read) => read("x-channel"), // absent → omitted entirely
      },
    });
    expect(ctx.extensions).toEqual({ abbucket: "B" });
    expect(getContextExtension(ctx, "abBucket")).toBe("B");
    expect(getContextExtension(ctx, "channel")).toBeUndefined();
  });

  it("defaults to an empty record so every existing caller is unaffected", () => {
    expect(createRequestContext().extensions).toEqual({});
  });

  it("round-trips extensions through serialize → a downstream context", () => {
    const page = createRequestContext({
      headers: { "x-tenant": "acme" },
      extensions: { tier: () => "gold" },
    });
    const forwarded = serializeContext(page);
    expect(forwarded["x-mvp-ctx-tier"]).toBe("gold");

    // What a fragment service does with the headers it received.
    const fragment = createRequestContext({ headers: forwarded });
    expect(fragment.extensions.tier).toBe("gold");
    expect(fragment.tenant).toBe("acme");
  });

  it("lets a locally declared parser override an inbound value", () => {
    const ctx = createRequestContext({
      headers: { "x-mvp-ctx-tier": "silver" },
      extensions: { tier: () => "gold" },
    });
    expect(ctx.extensions.tier).toBe("gold");
  });

  it("carries inbound extensions through when no parser is declared", () => {
    const ctx = createRequestContext({
      headers: { "x-mvp-ctx-tier": "silver", "x-mvp-ctx-": "ignored" },
    });
    expect(ctx.extensions).toEqual({ tier: "silver" });
  });
});
