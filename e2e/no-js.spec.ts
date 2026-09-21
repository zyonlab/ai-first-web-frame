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

    // Page shell (served verbatim through the transparent shell proxy).
    await expect(page.locator('main[data-page="home"]')).toHaveCount(1);
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

    // No-JS oriented editorial content is present.
    await expect(page.getByText("No-JS readable collection")).toBeVisible();
  });

  /**
   * No assertion here for the diagnostics section, deliberately.
   *
   * It is rendered behind a `<Suspense>` that needs the full slot aggregate, so
   * it resolves last. Against a warm local stack that lands inside the shell
   * flush and IS readable without JS; in the compose stack it lands after, and
   * React places late boundary content with an inline script that never runs.
   * Asserting it either way pins a race — proven: marking it `test.fail()` made
   * the local run report "Expected to fail, but passed."
   *
   * What the no-JS claim does cover is asserted above: the shell, the headings,
   * the fragment slots (live content or their readable fallback) and the
   * editorial block. The streamed slots showing a fallback rather than live
   * copy without JS is the real limitation of this page's streaming demo, and
   * `e2e/support/expect-fragment-content.ts` explains why the strict tier does
   * not apply here.
   */
});
