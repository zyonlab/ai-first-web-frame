import { expect, test } from "@playwright/test";

// Product route composed through shell-gateway plus the standalone
// page-product service redirect chain (port 4102).
test.describe("product route via shell-gateway", () => {
  test("responds 200 with shell marker and product page", async ({ page }) => {
    const response = await page.goto("/product/123");
    expect(response?.status()).toBe(200);

    const marker = page.locator('[data-shell-gateway="true"]');
    await expect(marker).toHaveCount(1);
    await expect(marker).toContainText("@mvp/page-product");

    const main = page.locator('main[data-page="product"]');
    await expect(main).toHaveCount(1);
    await expect(main).toHaveAttribute("data-product-id", "123");
  });

  test("renders static block, ISR promotion and dynamic recommendations", async ({
    page,
  }) => {
    await page.goto("/product/123");

    // Static proof block (real fragment or fallback both carry the marker).
    await expect(
      page.locator('[data-fragment="static-product-proof"]').first(),
    ).toBeVisible();

    // Promotion (ISR strategy on product page) and dynamic recommendations.
    await expect(
      page.locator('[data-fragment="promotion-banner"]').first(),
    ).toBeVisible();
    await expect(
      page.locator('[data-fragment="recommendation-widget"]').first(),
    ).toBeVisible();

    // Render strategy diagnostics advertise the expected strategies.
    const strategies = page.locator('[data-render-strategies="product"]');
    await expect(strategies).toContainText("static:");
    await expect(strategies).toContainText("isr:");
    await expect(strategies).toContainText("dynamic-ssr:");
  });

  test("renders the product request trace section", async ({ page }) => {
    await page.goto("/product/123");
    const trace = page.locator('[data-request-trace="product"]');
    await expect(trace).toHaveCount(1);
    await expect(
      trace.getByRole("heading", { name: "Request trace" }),
    ).toBeVisible();
  });
});

test.describe("standalone page-product service (port 4102)", () => {
  test("root redirects to /product/123", async ({ page }) => {
    const response = await page.goto("http://127.0.0.1:4102/");
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/product/123");
    await expect(page.locator('main[data-page="product"]')).toHaveCount(1);
  });

  test("redirect status code is a redirect (30x)", async ({ request }) => {
    const response = await request.get("http://127.0.0.1:4102/", {
      maxRedirects: 0,
    });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(response.headers().location).toContain("/product/123");
  });
});
