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

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "@playwright/test";
import {
  evaluateRuntime,
  type PaneObservation,
  type PaneSource,
  type RuntimeObservation,
} from "../tools/runtime-gate/src/checks.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const url = argv[argv.indexOf("--url") + 1]?.startsWith("http")
  ? argv[argv.indexOf("--url") + 1]
  : "http://localhost:4100/trade/BTC";

/**
 * The Core Web Vitals ceilings the page under test declares.
 *
 * Resolved by matching the URL's path against each page's own
 * `src/manifest.ts` `route` (the same "no hand-kept page→URL table" rule
 * `deploy-affected` follows), then reading the numeric fields out of that
 * page's `src/budget.ts`. Regex rather than an import because this runs under
 * `tsx` against source that imports `@mvp/*`, and a missing ceiling must
 * degrade to "skipped", never to a hard failure.
 */
function readWebVitalBudget(
  targetUrl: string,
): { maxLCPMs?: number; maxCLS?: number; maxTTFBMs?: number } | undefined {
  const appsDir = join(repoRoot, "apps");
  if (!existsSync(appsDir)) return undefined;
  const pathname = new URL(targetUrl).pathname;
  for (const entry of readdirSync(appsDir)) {
    const manifestPath = join(appsDir, entry, "src", "manifest.ts");
    const budgetPath = join(appsDir, entry, "src", "budget.ts");
    if (!existsSync(manifestPath) || !existsSync(budgetPath)) continue;
    const route = /route:\s*"([^"]+)"/.exec(
      readFileSync(manifestPath, "utf8"),
    )?.[1];
    if (!route) continue;
    // `/product/:id` matches `/product/123`; `/` matches only `/`.
    const pattern = new RegExp(
      `^${route.replace(/:[^/]+/g, "[^/]+").replace(/\//g, "\\/")}$`,
    );
    if (!pattern.test(pathname)) continue;
    const budgetSource = readFileSync(budgetPath, "utf8");
    const num = (field: string) => {
      const raw = new RegExp(`${field}:\\s*([0-9.]+)`).exec(budgetSource)?.[1];
      return raw === undefined ? undefined : Number(raw);
    };
    const budget = {
      maxLCPMs: num("maxLCPMs"),
      maxCLS: num("maxCLS"),
      maxTTFBMs: num("maxTTFBMs"),
    };
    if (Object.values(budget).every((value) => value === undefined)) {
      // Found the page but parsed no ceiling: say so, or the vitals checks
      // would silently report "no ceiling declared" forever after a rename of
      // the budget fields — exactly the silent-non-enforcement this whole
      // change set exists to remove.
      console.warn(
        `[verify:runtime] matched ${entry} but parsed no web-vital ceilings from src/budget.ts`,
      );
    }
    return budget;
  }
  console.warn(
    `[verify:runtime] no page manifest route matched ${pathname} — web vitals will be reported as skipped`,
  );
  return undefined;
}

/**
 * Collects LCP, CLS and TTFB from the live page.
 *
 * LCP and CLS come from `PerformanceObserver` with `buffered: true`, so entries
 * emitted before this script ran are still seen; TTFB is
 * `responseStart - requestStart` off the navigation entry. INP is NOT collected:
 * it measures real interaction latency, and a headless scripted click cannot
 * produce an honest value — it is reported as skipped instead of faked.
 */
async function measureWebVitals(page: Page): Promise<{
  lcpMs?: number;
  cls?: number;
  ttfbMs?: number;
  clsSources?: string[];
}> {
  return page.evaluate(async () => {
    const result: {
      lcpMs?: number;
      cls?: number;
      ttfbMs?: number;
      clsSources?: string[];
    } = {};
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (navigation) {
      result.ttfbMs = Math.max(
        0,
        navigation.responseStart - navigation.requestStart,
      );
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            result.lcpMs = Math.max(result.lcpMs ?? 0, entry.startTime);
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });
        const clsObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & {
              value: number;
              hadRecentInput: boolean;
            };
            if (shift.hadRecentInput) continue;
            result.cls = (result.cls ?? 0) + shift.value;
            // A bare CLS number says a page shifts but not WHAT shifted, which
            // is the whole question when the budget fails. `sources` names the
            // elements and their before/after boxes.
            const sources =
              (
                shift as unknown as {
                  sources?: {
                    node?: Node | null;
                    previousRect?: DOMRectReadOnly;
                    currentRect?: DOMRectReadOnly;
                  }[];
                }
              ).sources ?? [];
            for (const source of sources) {
              const node = source.node;
              const element =
                node && node.nodeType === 1 ? (node as Element) : undefined;
              const marker = element
                ? [
                    element.tagName.toLowerCase(),
                    element.getAttribute("data-fragment") &&
                      `data-fragment=${element.getAttribute("data-fragment")}`,
                    element.getAttribute("data-island") &&
                      `data-island=${element.getAttribute("data-island")}`,
                    element.getAttribute("id") &&
                      `#${element.getAttribute("id")}`,
                  ]
                    .filter(Boolean)
                    .join(" ")
                : "(non-element)";
              const box = (rect?: DOMRectReadOnly) =>
                rect
                  ? `${Math.round(rect.y)},${Math.round(rect.height)}`
                  : "none";
              result.clsSources = [
                ...(result.clsSources ?? []),
                `${shift.value.toFixed(4)} <${marker}> y,h ${box(source.previousRect)} -> ${box(source.currentRect)}`,
              ];
            }
          }
        });
        clsObserver.observe({ type: "layout-shift", buffered: true });
        // A page that never shifted has CLS 0 — that is a measurement, and a
        // passing one. Leaving `cls` undefined reported it as "not measured"
        // and SKIPPED the budget, so the same page could SKIP on one run and
        // FAIL on the next with no way to tell a stable page from an
        // unobserved one. Only a browser that cannot observe `layout-shift`
        // at all now reports nothing.
        result.cls = result.cls ?? 0;
      } catch {
        // A browser without these entry types reports nothing rather than 0.
      }
      // Give the observers a beat to flush buffered entries.
      setTimeout(done, 600);
    });
    return result;
  });
}

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

/**
 * esbuild's `keepNames` (which tsx hardcodes on) rewrites function definitions
 * to `__name(fn, "name")`. Playwright serialises an `evaluate` callback with
 * `Function.prototype.toString()` and runs that source in the page, where no
 * `__name` exists — so every callback below would die with
 * `ReferenceError: __name is not defined`. It applies to nested `const fn = ()
 * => {}` too, so "just avoid named functions" is not a rule that holds.
 *
 * Passed as a string on purpose: an init script written as a function would go
 * through the same transform and need the helper it is supposed to install.
 */
const KEEP_NAMES_SHIM =
  'globalThis.__name = globalThis.__name || function (fn, name) { try { Object.defineProperty(fn, "name", { value: name, configurable: true }); } catch {} return fn; };';

async function main() {
  const browser = await chromium.launch();
  try {
    await runGate(browser);
  } finally {
    // Every exit path, including a thrown error. Without this the browser
    // stayed up, the event loop never emptied, and the process hung: in CI the
    // gate printed its failure JSON in 4.5 seconds and then sat there for two
    // and a half hours until the job was cancelled.
    await browser.close();
  }
}

async function runGate(browser: Browser) {
  const page = await browser.newPage({
    viewport: { width: 1680, height: 1000 },
  });
  await page.addInitScript({ content: KEEP_NAMES_SHIM });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const staticRequests: { url: string; status: number }[] = [];
  const failedRequests: { url: string; status: number }[] = [];

  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !isBenign(m.text()))
      consoleErrors.push(m.text());
  });
  page.on("response", (r) => {
    const u = r.url();
    if (/\/_next\/static\/|\/assets\//.test(u))
      staticRequests.push({ url: u, status: r.status() });
    if (r.status() >= 400) failedRequests.push({ url: u, status: r.status() });
  });

  let reachable = true;
  // Why it was unreachable, not just that it was. `/markets` failed here while
  // the gateway's own trace showed it answering that request 200 in 102ms, and
  // the bare message could not tell a navigation error from a 4xx.
  let unreachableReason = "";
  try {
    const res = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    if (!res) {
      reachable = false;
      unreachableReason = "navigation returned no response";
    } else if (res.status() >= 400) {
      reachable = false;
      unreachableReason = `HTTP ${res.status()}`;
    }
  } catch (error) {
    reachable = false;
    unreachableReason = String(error).split("\n")[0] ?? "navigation threw";
  }

  if (!reachable) {
    const msg = `target not reachable: ${url} — ${unreachableReason}`;
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

  // The vitals observers need the live page; main()'s finally closes it.
  const webVitals = await measureWebVitals(page);

  const obs: RuntimeObservation = {
    pageErrors,
    consoleErrors,
    staticRequests,
    failedRequests,
    panes,
    paneSource,
    horizontalOverflowPx,
    webVitals: { ...webVitals, budget: readWebVitalBudget(url) },
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
