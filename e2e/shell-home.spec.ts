import { expect, test } from "@playwright/test";
import { expectFragmentContent } from "./support/expect-fragment-content";

// Composed home page served by shell-gateway (port 4100).
// Assertions target stable SSR contracts: shell marker, fragment slots
// (real content or fallback), and the request trace section.
// Set E2E_STRICT=1 to require live fragment content only (see
// e2e/support/expect-fragment-content.ts and e2e/README.md).
test.describe("shell-gateway composed home page", () => {
  test("responds 200 and transparently proxies the home page", async ({
    page,
  }) => {
    const response = await page.goto("/");
    expect(response, "shell home should respond").toBeTruthy();
    expect(response?.status()).toBe(200);

    // The shell is a transparent proxy: it returns page-home's HTML verbatim
    // (so hydration stays byte-consistent) and no longer injects a chrome
    // wrapper. Its passage is still provable via the trace header it stamps.
    expect(response?.headers()["x-trace-id"]).toBeTruthy();
    await expect(page.locator('main[data-page="home"]')).toHaveCount(1);
    await expect(page.locator('[data-shell-gateway="true"]')).toHaveCount(0);
  });

  test("exposes trace headers on the composed response", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.headers()["x-trace-id"]).toBeTruthy();
    expect(response?.headers()["x-shell-cache"]).toBe("route-registry");
  });

  test("renders home page core content", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('main[data-page="home"]')).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "MVP Storefront Home" }),
    ).toBeVisible();
  });

  test("renders promotion banner fragment content or its fallback", async ({
    page,
  }) => {
    await page.goto("/");
    const promotion = page.locator('[data-fragment="promotion-banner"]');
    // Live fragment copy by default; E2E_STRICT=1 rejects the SSR fallback
    // copy ("Featured offers are loading." / "Promotion unavailable: ...").
    await expectFragmentContent(promotion.first(), {
      live: /Limited time offer|限时优惠/,
      fallback: /Featured offers are loading|Promotion unavailable/,
    });
  });

  test("renders recommendation widget fragment content or its fallback", async ({
    page,
  }) => {
    await page.goto("/");
    const recommendations = page.locator(
      '[data-fragment="recommendation-widget"]',
    );
    // Live fragment copy by default; E2E_STRICT=1 rejects the SSR fallback
    // copy ("Recommendations are loading." / "Recommendations unavailable: ...").
    await expectFragmentContent(recommendations.first(), {
      live: /Recommended for you/,
      fallback: /Recommendations are loading|Recommendations unavailable/,
    });
  });

  test("renders the request trace section", async ({ page }) => {
    await page.goto("/");
    const trace = page.locator('[data-request-trace="home"]');
    await expect(trace).toHaveCount(1);
    await expect(
      trace.getByRole("heading", { name: "Request trace" }),
    ).toBeVisible();
    await expect(trace.locator("pre")).not.toBeEmpty();
  });

  test("unknown route returns the shell 404 fallback", async ({ page }) => {
    const response = await page.goto("/definitely-not-a-route");
    expect(response?.status()).toBe(404);
    await expect(page.locator('main[data-shell-404="true"]')).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
  });
});
