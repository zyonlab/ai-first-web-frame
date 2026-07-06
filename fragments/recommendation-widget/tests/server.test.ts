import { describe, expect, it } from "vitest";
import { recommendationWidgetBudget } from "../src/budget";
import { validateRecommendationWidgetManifest } from "../src/manifest";
import { buildServer } from "../src/server";

describe("recommendation-widget fragment service", () => {
  it("/ returns a browser-readable service demo", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("recommendation-widget fragment");
    expect(response.body).toContain("Recommended for you");
    expect(response.body).toContain("POST http://localhost:4202/render");
  });

  it("/health returns ok", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });
    expect(response.json()).toMatchObject({ status: "ok" });
  });

  it("/manifest passes schema validation", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/manifest" });
    expect(validateRecommendationWidgetManifest(response.json())).toBe(true);
  });

  it("/render returns recommendation HTML", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { ctx: { locale: "en-US" }, props: { scene: "home", limit: 2 } },
    });
    expect(response.json().html).toContain("Recommended for you");
  });

  it("honors limit", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: { limit: 1 } },
    });
    expect(response.json().html.match(/data-product-id/g)).toHaveLength(1);
  });

  it("declares a fragment budget", () => {
    expect(recommendationWidgetBudget).toMatchObject({
      scope: "fragment",
      maxFragmentLatencyMs: 200,
    });
  });
});
