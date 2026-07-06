import { expect, test } from "@playwright/test";

// Composed home page served by shell-gateway (port 4100).
// Assertions target stable SSR contracts: shell marker, fragment slots
// (real content or fallback), and the request trace section.
test.describe("shell-gateway composed home page", () => {
  test("responds 200 and carries the shell gateway marker", async ({
    page,
  }) => {
    const response = await page.goto("/");
    expect(response, "shell home should respond").toBeTruthy();
    expect(response?.status()).toBe(200);

    const marker = page.locator('[data-shell-gateway="true"]');
    await expect(marker).toHaveCount(1);
    await expect(marker).toContainText("Shell gateway route:");
    await expect(marker).toContainText("@mvp/page-home");
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
    await expect(promotion.first()).toBeVisible();
    // Either live fragment copy or the SSR fallback copy must be readable.
    await expect(promotion.first()).toContainText(
      /Limited time offer|限时优惠|Featured offers are loading|Promotion unavailable/,
    );
  });

  test("renders recommendation widget fragment content or its fallback", async ({
    page,
  }) => {
    await page.goto("/");
    const recommendations = page.locator(
      '[data-fragment="recommendation-widget"]',
    );
    await expect(recommendations.first()).toBeVisible();
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
