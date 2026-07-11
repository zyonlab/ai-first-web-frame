/**
 * verify:runtime — the composition-runtime gate (docs/AI_NATIVE_DEVX.md §6).
 *
 * Drives the composed page in a real browser and asserts the plane `pnpm verify`
 * can't see: hydration is clean (no page/console errors, no React #418), the
 * declared assets are actually delivered (no /_next or /assets 404s), no pane
 * strands its content above a large void, the page doesn't overflow, and — on
 * pages that have one — the signature interaction (order-book row → order-form
 * price) still fires.
 *
 * Layout-fit is measured against `[data-area]` grid cells when the page has
 * them (today: trade only), falling back to each `[data-fragment]` section's
 * own rendered box otherwise — every composed page (home/product/markets/
 * portfolio/trade) emits `data-fragment` on each fragment's root element, so
 * this generalizes the gate beyond the trade page (see `tools/runtime-gate`).
 *
 * The verdict logic lives in `tools/runtime-gate/checks.ts` (pure, unit-tested);
 * this script only collects observations with playwright.
 *
 * Usage:
 *   pnpm verify:runtime [--url http://localhost:4100/trade/BTC] [--json]
 *   Requires the target to be up (docker compose up / a running page service).
 */

import { chromium, type Page } from "@playwright/test";
import {
  evaluateRuntime,
  type PaneObservation,
  type PaneSource,
  type RuntimeObservation,
} from "../tools/runtime-gate/src/checks.ts";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const url = argv[argv.indexOf("--url") + 1]?.startsWith("http")
  ? argv[argv.indexOf("--url") + 1]
  : "http://localhost:4100/trade/BTC";

/** Benign console noise that isn't a contract failure (e.g. missing favicon). */
const isBenign = (s: string) =>
  /favicon\.ico|Failed to load resource: the server responded with a status of 404 \(Not Found\)$/i.test(
    s,
  );

/**
 * Measures each element matched by `selector`'s pane geometry: how much of
 * the element's own box its content actually fills. Content bottom = the
 * furthest child's bottom edge below the element's top, so a multi-child pane
 * (e.g. a form column: order-form + docked account-bar) isn't miscounted as a
 * void. A childless (text-only) element has nothing to measure a void
 * against, so it's treated as fully filled rather than reported as 100% void.
 */
async function measurePanes(
  page: Page,
  selector: string,
  areaAttr: string,
): Promise<PaneObservation[]> {
  return page.$$eval(
    selector,
    (els, areaAttr) =>
      els.map((n) => {
        const rect = n.getBoundingClientRect();
        let contentBottom = n.children.length === 0 ? rect.bottom : rect.top;
        for (const kid of Array.from(n.children)) {
          const kr = kid.getBoundingClientRect();
          if (kr.bottom > contentBottom) contentBottom = kr.bottom;
        }
        return {
          area: n.getAttribute(areaAttr) ?? "?",
          areaHeight: Math.round(rect.height),
          contentHeight: Math.round(
            Math.min(rect.height, contentBottom - rect.top),
          ),
        };
      }),
    areaAttr,
  );
}

/** `[data-area]` grid cells when present (trade), else `[data-fragment]`
 * sections (every composed page) — never silently "no panes" when a fallback
 * plane exists to measure instead. */
async function measurePanesWithFallback(
  page: Page,
): Promise<{ panes: PaneObservation[]; paneSource: PaneSource }> {
  const areaPanes = await measurePanes(page, "[data-area]", "data-area");
  if (areaPanes.length > 0)
    return { panes: areaPanes, paneSource: "data-area" };
  const fragmentPanes = await measurePanes(
    page,
    "[data-fragment]",
    "data-fragment",
  );
  return {
    panes: fragmentPanes,
    paneSource: fragmentPanes.length > 0 ? "data-fragment" : "none",
  };
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1680, height: 1000 },
  });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const staticRequests: { url: string; status: number }[] = [];

  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !isBenign(m.text()))
      consoleErrors.push(m.text());
  });
  page.on("response", (r) => {
    const u = r.url();
    if (/\/_next\/static\/|\/assets\//.test(u))
      staticRequests.push({ url: u, status: r.status() });
  });

  let reachable = true;
  try {
    const res = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    if (!res || res.status() >= 400) reachable = false;
  } catch {
    reachable = false;
  }

  if (!reachable) {
    await browser.close();
    const msg = `target not reachable: ${url} (is the stack up?)`;
    process.stdout.write(
      json
        ? `${JSON.stringify({ status: "failed", error: msg })}\n`
        : `verify:runtime — ${msg}\n`,
    );
    process.exitCode = 1;
    return;
  }

  await page.waitForTimeout(2500);

  const { panes, paneSource } = await measurePanesWithFallback(page);

  const horizontalOverflowPx = await page.evaluate(() =>
    Math.max(
      0,
      document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  );

  // Signature interaction contract: an order-book row drives the order-form
  // price. Only trade composes both order-book and order-form, so this is
  // conditional on the page actually having one — explicit (`skipped: true`)
  // rather than the check simply being absent from the report.
  const cell = page
    .locator('tr[data-price] td[data-field="price"][data-value]')
    .first();
  const interaction: RuntimeObservation["interaction"] =
    (await cell.count()) > 0
      ? await (async () => {
          const clicked = await cell.getAttribute("data-value");
          await cell.click();
          await page.waitForTimeout(500);
          const value = await page
            .locator("[data-of-price] input")
            .inputValue()
            .catch(() => null);
          return {
            name: "orderbook→order-form-price",
            ok: value === String(Number(clicked)),
            detail: `clicked ${clicked} → form ${value}`,
          };
        })()
      : {
          name: "orderbook→order-form-price",
          ok: true,
          skipped: true,
          detail: "no order-book on this page — skipped",
        };

  await browser.close();

  const obs: RuntimeObservation = {
    pageErrors,
    consoleErrors,
    staticRequests,
    panes,
    paneSource,
    horizontalOverflowPx,
    interaction,
  };
  const { checks, ok } = evaluateRuntime(obs);

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ status: ok ? "ok" : "failed", url, checks, obs }, null, 2)}\n`,
    );
  } else {
    console.log(`verify:runtime — ${url}`);
    for (const c of checks) {
      const label = c.skipped ? "SKIP" : c.ok ? "PASS" : "FAIL";
      console.log(`  ${label} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    console.log(ok ? "verify:runtime OK" : "verify:runtime FAILED");
  }
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify({ status: "failed", error: String(error) })}\n`,
  );
  process.exitCode = 1;
});
