/**
 * verify:runtime — the composition-runtime gate (docs/AI_NATIVE_DEVX.md §6).
 *
 * Drives the composed page in a real browser and asserts the plane `pnpm verify`
 * can't see: hydration is clean (no page/console errors, no React #418), the
 * declared assets are actually delivered (no /_next or /assets 404s), no pane
 * strands its content above a large void, the page doesn't overflow, and the
 * signature interaction (order-book row → order-form price) still fires.
 *
 * The verdict logic lives in `tools/runtime-gate/checks.ts` (pure, unit-tested);
 * this script only collects observations with playwright.
 *
 * Usage:
 *   pnpm verify:runtime [--url http://localhost:4100/trade/BTC] [--json]
 *   Requires the target to be up (docker compose up / a running page service).
 */

import { chromium } from "@playwright/test";
import {
  evaluateRuntime,
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

  const panes = await page.$$eval("[data-area]", (els) =>
    els.map((n) => {
      const rect = n.getBoundingClientRect();
      // Content height = the furthest child bottom below the pane top, so
      // multi-child panes (e.g. a form column: order-form + docked account-bar)
      // aren't miscounted as a void.
      let contentBottom = rect.top;
      for (const kid of Array.from(n.children)) {
        const kr = kid.getBoundingClientRect();
        if (kr.bottom > contentBottom) contentBottom = kr.bottom;
      }
      return {
        area: n.getAttribute("data-area") ?? "?",
        areaHeight: Math.round(rect.height),
        contentHeight: Math.round(
          Math.min(rect.height, contentBottom - rect.top),
        ),
      };
    }),
  );

  const horizontalOverflowPx = await page.evaluate(() =>
    Math.max(
      0,
      document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  );

  // Signature interaction contract: an order-book row drives the order-form price.
  let interaction: RuntimeObservation["interaction"];
  const cell = page
    .locator('tr[data-price] td[data-field="price"][data-value]')
    .first();
  if ((await cell.count()) > 0) {
    const clicked = await cell.getAttribute("data-value");
    await cell.click();
    await page.waitForTimeout(500);
    const value = await page
      .locator("[data-of-price] input")
      .inputValue()
      .catch(() => null);
    interaction = {
      name: "orderbook→order-form-price",
      ok: value === String(Number(clicked)),
      detail: `clicked ${clicked} → form ${value}`,
    };
  }

  await browser.close();

  const obs: RuntimeObservation = {
    pageErrors,
    consoleErrors,
    staticRequests,
    panes,
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
      console.log(
        `  ${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`,
      );
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
