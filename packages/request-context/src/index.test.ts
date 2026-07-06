import { describe, expect, it } from "vitest";
import {
  createRequestContext,
  deserializeContext,
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
