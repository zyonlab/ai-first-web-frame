import { expect, test } from "@playwright/test";

// SSR semantics: the composed home page must be fully readable with client
// JavaScript disabled. This spec only runs in the "no-js" project, which
// sets javaScriptEnabled: false (see playwright.config.ts).
test.describe("home page without client JavaScript", () => {
  test.skip(
    ({ javaScriptEnabled }) => javaScriptEnabled !== false,
    "only meaningful in the no-js project",
  );

  test("full home content is server-rendered", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // Shell marker and page shell.
    await expect(page.locator('[data-shell-gateway="true"]')).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "MVP Storefront Home" }),
    ).toBeVisible();

    // Both fragment slots deliver readable content (live or fallback).
    await expect(
      page.locator('[data-fragment="promotion-banner"]').first(),
    ).toBeVisible();
    await expect(
      page.locator('[data-fragment="recommendation-widget"]').first(),
    ).toBeVisible();

    // No-JS oriented editorial content and diagnostics are present.
    await expect(page.getByText("No-JS readable collection")).toBeVisible();
    await expect(
      page
        .locator('[data-request-trace="home"]')
        .getByRole("heading", { name: "Request trace" }),
    ).toBeVisible();
  });
});
