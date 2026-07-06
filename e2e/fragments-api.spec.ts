import { expect, test } from "@playwright/test";

// Direct contract tests against the standalone fragment services.
// These use the API request fixture only (no browser page), so they are
// excluded from the no-js browser project in playwright.config.ts.
const services = [
  {
    name: "promotion-banner",
    baseUrl: "http://127.0.0.1:4201",
    renderProps: { scene: "home", campaignId: "e2e-campaign" },
    htmlMarker: 'data-fragment="promotion-banner"',
    // promotion-banner treats missing props as a client error.
    missingProps: { status: 400, htmlContains: 'data-fallback="true"' },
  },
  {
    name: "recommendation-widget",
    baseUrl: "http://127.0.0.1:4202",
    renderProps: { scene: "home", limit: 3 },
    htmlMarker: 'data-fragment="recommendation-widget"',
    // recommendation-widget falls back to default scene/limit instead.
    missingProps: {
      status: 200,
      htmlContains: 'data-fragment="recommendation-widget"',
    },
  },
] as const;

for (const service of services) {
  test.describe(`${service.name} fragment service`, () => {
    test("GET /health returns ok JSON", async ({ request }) => {
      const response = await request.get(`${service.baseUrl}/health`);
      expect(response.status()).toBe(200);
      // Fragments also expose uptimeMs on /health; match the stable contract
      // fields without pinning the exact object shape.
      expect(await response.json()).toMatchObject({
        status: "ok",
        service: service.name,
      });
    });

    test("GET /manifest exposes the fragment contract", async ({ request }) => {
      const response = await request.get(`${service.baseUrl}/manifest`);
      expect(response.status()).toBe(200);
      const manifest = await response.json();
      expect(manifest.name).toContain(service.name);
      expect(manifest.version).toBeTruthy();
    });

    test("POST /render returns fragment HTML for a valid request", async ({
      request,
    }) => {
      const response = await request.post(`${service.baseUrl}/render`, {
        data: {
          ctx: { locale: "en-US", traceId: "e2e-trace" },
          props: service.renderProps,
        },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.html).toContain(service.htmlMarker);
      expect(body.assets).toBeDefined();
      expect(body.cache).toBeDefined();
      expect(body.metadata.name).toContain(service.name);
    });

    test("POST /render without props degrades gracefully", async ({
      request,
    }) => {
      const response = await request.post(`${service.baseUrl}/render`, {
        data: {},
      });
      expect(response.status()).toBe(service.missingProps.status);
      const body = await response.json();
      expect(body.html).toContain(service.missingProps.htmlContains);
    });
  });
}
