import { describe, expect, it } from "vitest";
import { promotionBannerBudget } from "../src/budget";
import { validatePromotionBannerManifest } from "../src/manifest";
import { buildServer } from "../src/server";

describe("promotion-banner fragment service", () => {
  it("/ returns a browser-readable service demo", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("promotion-banner fragment");
    expect(response.body).toContain("Limited time offer");
    expect(response.body).toContain("POST http://localhost:4201/render");
  });

  it("/health returns ok", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });
    expect(response.json()).toMatchObject({ status: "ok" });
  });

  it("/manifest passes schema validation", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/manifest" });
    expect(validatePromotionBannerManifest(response.json())).toBe(true);
  });

  it("/assets returns js and css arrays", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/assets" });
    expect(response.json()).toMatchObject({ js: [], css: expect.any(Array) });
  });

  it("/render returns localized HTML", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: {
        ctx: { locale: "zh-CN" },
        props: { scene: "home", campaignId: "summer" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().html).toContain("限时优惠");
  });

  it("/render returns a safe fallback for missing props", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { ctx: {} },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().html).toContain("data-fallback");
  });

  it("declares a fragment budget", () => {
    expect(promotionBannerBudget).toMatchObject({
      scope: "fragment",
      maxFragmentLatencyMs: 200,
    });
  });
});
