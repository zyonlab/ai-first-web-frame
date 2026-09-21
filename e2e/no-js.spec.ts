import { expect, test } from "@playwright/test";

// SSR semantics without client JavaScript. This spec only runs in the "no-js"
// project, which sets javaScriptEnabled: false (see playwright.config.ts).
//
// The guarantee is deliberately narrower than "fully readable", which is what
// this header used to claim and what the page cannot deliver. page-home
// declares `streaming:suspense-per-slot`, and a streamed slot resolves after
// the shell is flushed: React places late `<Suspense>` content with an inline
// script, so with JS off the slot keeps showing its fallback. What IS
// guaranteed, and asserted below:
//
//   - the shell, its headings and the no-JS editorial content are server-rendered
//   - the realtime island's SSR snapshot is in the shell, not behind a boundary,
//     so its numbers are readable
//   - every fragment slot is present and carries readable copy — live if it
//     resolved into the shell, otherwise its fallback line, which is
//     `fallback-isolation`, another thing this page declares, working as designed
//
// Not guaranteed, and not asserted: that a streamed slot shows LIVE copy, or
// that the diagnostics section (which needs the full slot aggregate, so its
// boundary resolves last of all) appears at all.
test.describe("home page without client JavaScript", () => {
  test.skip(
    ({ javaScriptEnabled }) => javaScriptEnabled !== false,
    "only meaningful in the no-js project",
  );

  test("the shell, the island snapshot and every slot are readable", async ({
    page,
  }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // Page shell (served verbatim through the transparent shell proxy).
    await expect(page.locator('main[data-page="home"]')).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "MVP Storefront Home" }),
    ).toBeVisible();

    // Every fragment slot is present AND carries readable text — live copy if
    // it resolved into the shell, otherwise its fallback line. Asserting
    // non-empty text is the point: "visible" alone passes on an empty box, and
    // an empty box is exactly what a no-JS reader must never get.
    for (const fragment of ["promotion-banner", "recommendation-widget"]) {
      const slot = page.locator(`[data-fragment="${fragment}"]`).first();
      await expect(slot).toBeVisible();
      await expect(slot).not.toBeEmpty();
    }

    // The realtime island is rendered directly in <main>, not behind a
    // boundary, so its SSR snapshot is readable with no JS at all. This is the
    // claim `RealtimeInsights.tsx` makes about `initialSnapshot`.
    const island = page.locator('[data-island="realtime-insights"]');
    await expect(island).toBeVisible();
    await expect(island.locator('[data-field="heat"]')).not.toBeEmpty();
    await expect(island.locator('[data-field="stock"]')).not.toBeEmpty();

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
