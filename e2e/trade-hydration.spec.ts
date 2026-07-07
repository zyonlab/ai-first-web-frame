import { expect, test } from "@playwright/test";

// Trade-terminal island hydration + the signature order-book -> order-form price
// flow. This targets the STANDALONE page-trade app (port 4103) directly, not the
// composed shell (4100): hydration needs page-trade's own /_next/static client
// chunks, which the shell gateway does not proxy.
//
// Requires the trade stack up (page-trade + the trade fragments). See
// scripts/docker-smoke.mts / docker compose. Skipped gracefully when 4103 is down.
const TRADE_URL = "http://localhost:4103/trade/BTC";

test.describe("trade terminal island hydration", () => {
  test("SSR trade page is no-JS readable and carries island mount nodes", async ({
    page,
  }) => {
    const response = await page.goto(TRADE_URL, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status(), "page-trade /trade/BTC should respond 200").toBe(
      200,
    );
    await expect(page.locator('[data-page="trade"]')).toHaveCount(1);
    // The four React islands emit consistent camelCase mount markers.
    for (const name of ["marketHeader", "chart", "orderForm", "accountBar"]) {
      await expect(page.locator(`[data-island="${name}"]`)).toHaveCount(1);
    }
    // Order book rendered real ladder rows (not a fallback).
    await expect(
      page.locator('tr[data-price] td[data-field="price"]').first(),
    ).toBeVisible();
  });

  test("clicking an order-book row drives the order-form price (shared store)", async ({
    page,
  }, testInfo) => {
    // Hydration needs JavaScript; the no-js project only covers the SSR contract.
    test.skip(
      testInfo.project.name === "no-js",
      "island hydration requires JavaScript",
    );
    await page.goto(TRADE_URL, { waitUntil: "networkidle" });

    // Pick a concrete ask/bid price cell from the order book.
    const priceCell = page
      .locator('tr[data-price] td[data-field="price"][data-value]')
      .first();
    await expect(priceCell).toBeVisible();
    const clicked = await priceCell.getAttribute("data-value");
    expect(clicked, "order-book row should carry a numeric price").toBeTruthy();

    // Click the row → hydration bridge publishes TRADE_ORDER_DRAFT_PRICE.
    await priceCell.click();

    // The order-form island subscribes, flips to a limit draft, and its price
    // input reflects the clicked price — WITHOUT a navigation/reload.
    const priceInput = page.locator("[data-of-price] input");
    await expect(priceInput).toBeVisible({ timeout: 10_000 });
    await expect(priceInput).toHaveValue(String(Number(clicked)));

    // Prove no full-page navigation happened (SPA-style island update).
    await expect(page).toHaveURL(TRADE_URL);
    // Unrelated chrome did not re-render away: heading still present.
    await expect(page.locator('[data-page="trade"]')).toHaveCount(1);
  });
});
