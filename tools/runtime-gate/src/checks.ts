/**
 * Runtime/visual contract evaluator (docs/AI_NATIVE_DEVX.md §6).
 *
 * The plane that `pnpm verify` can't see: every trade-demo defect this cycle —
 * fragment CSS not delivered, React #418, the `ticker.ETH` symbol-switch crash,
 * the 490px layout void — passed the unit gate green and was only visible in a
 * running browser. This module turns those into machine checks.
 *
 * PURE (observations in → verdict out) so it is unit-tested; the playwright
 * driver in `scripts/verify-runtime.mts` collects the observations and prints
 * the report.
 */

export type StaticRequest = { url: string; status: number };

/** One rendered pane and how much of it its content fills. */
export type PaneObservation = {
  area: string;
  areaHeight: number;
  contentHeight: number;
};

/**
 * Which selector produced `panes`. Only the trade page emits `[data-area]`
 * grid cells; every composed page (home/product/markets/portfolio/trade)
 * emits `[data-fragment]` on each fragment's own root element (success and
 * fallback paths both carry it — see fragment `render.ts` modules), so that
 * is the generic fallback measurement plane. `"none"` means neither selector
 * matched anything on the page.
 */
export type PaneSource = "data-area" | "data-fragment" | "none";

export type RuntimeObservation = {
  /** Uncaught page errors (already filtered of benign noise by the driver). */
  pageErrors: string[];
  /** console.error lines (filtered). */
  consoleErrors: string[];
  /** Requests to /_next/static or /assets (asset-delivery plane). */
  staticRequests: StaticRequest[];
  /**
   * Every response with a 4xx/5xx status, whatever its path. `staticRequests`
   * deliberately covers only the asset plane, so a failing request anywhere
   * else reached the report as nothing but the browser's unattributed
   * "Failed to load resource: the server responded with a status of 400"
   * console line — which is how a broken `<Image>` on the product page cost a
   * local stack reproduction to identify. Optional so existing fixtures and
   * older callers stay valid.
   */
  failedRequests?: StaticRequest[];
  /** Panes with their fill geometry (layout-fit plane); see `paneSource`. */
  panes: PaneObservation[];
  /** Which selector `panes` came from. Defaults to inferring from `panes`
   * (non-empty → `"data-area"`) when omitted, for older callers/fixtures. */
  paneSource?: PaneSource;
  /** Document horizontal overflow in px (0 = none). */
  horizontalOverflowPx: number;
  /**
   * Core Web Vitals measured in the real browser, plus the page's declared
   * ceilings.
   *
   * These are the budget fields that had NO enforcement anywhere:
   * `audit:bundle` says so itself ("Runtime-only budget metrics … are not
   * gated by this audit"), so `maxLCPMs` / `maxCLS` / `maxTTFBMs` sat in every
   * page's `budget.ts` as documentation. This is the plane where they can
   * actually be measured, next to the other browser-only checks.
   *
   * `undefined` for a metric means "not measured" and is reported as skipped —
   * never silently passed. INP is deliberately absent: it needs real user
   * interaction latency, which a headless run cannot produce honestly.
   */
  webVitals?: {
    lcpMs?: number;
    cls?: number;
    ttfbMs?: number;
    /**
     * One line per layout-shift source: score, the shifting element (with its
     * `data-fragment` / `data-island` marker when it has one) and its y,height
     * before and after. A bare CLS number says a page shifts but not what
     * shifted, which is the only question worth asking when the budget fails.
     */
    clsSources?: string[];
    budget?: { maxLCPMs?: number; maxCLS?: number; maxTTFBMs?: number };
  };
  /** Optional interaction-contract result (e.g. order-book → order-form price).
   * `skipped: true` means the contract doesn't apply to this page (e.g. no
   * order-book present) — reported explicitly rather than omitted, so a
   * reader can tell "not applicable" apart from "not collected". */
  interaction?: {
    name: string;
    ok: boolean;
    detail?: string;
    skipped?: boolean;
  };
};

export type RuntimeCheck = {
  name: string;
  ok: boolean;
  detail?: string;
  skipped?: boolean;
};

export type RuntimeThresholds = {
  /** Max tolerated pane void (areaHeight − contentHeight) before it's a fail. */
  maxPaneVoidPx: number;
  /** Max tolerated horizontal document overflow. */
  maxHorizontalOverflowPx: number;
};

export const DEFAULT_THRESHOLDS: RuntimeThresholds = {
  maxPaneVoidPx: 48,
  maxHorizontalOverflowPx: 2,
};

const is418 = (s: string) => /#418|Minified React error #418|hydrat/i.test(s);

export function evaluateRuntime(
  obs: RuntimeObservation,
  thresholds: RuntimeThresholds = DEFAULT_THRESHOLDS,
): { checks: RuntimeCheck[]; ok: boolean } {
  const checks: RuntimeCheck[] = [];

  // Hydration — no uncaught errors at all.
  const allErrors = [...obs.pageErrors, ...obs.consoleErrors];
  // A generic "Failed to load resource" says nothing about WHICH resource, so
  // attribute it from the observed 4xx/5xx responses.
  const failed = obs.failedRequests ?? [];
  const failedDetail =
    failed.length > 0
      ? ` [${failed
          .map((r) => `${r.status} ${r.url}`)
          .join(", ")
          .slice(0, 300)}]`
      : "";
  checks.push({
    name: "hydration-clean",
    ok: allErrors.length === 0,
    detail:
      allErrors.length === 0
        ? "0 page/console errors"
        : `${allErrors.length} error(s): ${allErrors[0]?.slice(0, 120)}${failedDetail}`,
  });

  // React #418 specifically (the shell-wrap hydration mismatch class).
  const react418 = allErrors.filter(is418);
  checks.push({
    name: "no-react-418",
    ok: react418.length === 0,
    detail:
      react418.length === 0
        ? "no hydration mismatch"
        : react418[0]?.slice(0, 120),
  });

  // Asset delivery — no static asset 404s (CSS-not-delivered / chunk-404 class).
  const badAssets = obs.staticRequests.filter((r) => r.status >= 400);
  checks.push({
    name: "assets-delivered",
    ok: badAssets.length === 0,
    detail:
      badAssets.length === 0
        ? `${obs.staticRequests.length} static request(s) ok`
        : `${badAssets.length} 4xx/5xx: ${badAssets[0]?.url}`,
  });

  // Layout fit — no pane strands its content above a large void (the 490px
  // header-void / 806px empty-rail class). Measured against `[data-area]`
  // grid cells when the page has them (trade), falling back to each
  // `[data-fragment]` section's own box on every other composed page —
  // same void-threshold logic either way, just a different pane source.
  const paneSource: PaneSource =
    obs.paneSource ?? (obs.panes.length > 0 ? "data-area" : "none");
  const worstVoid = obs.panes
    .map((p) => ({ ...p, void: p.areaHeight - p.contentHeight }))
    .sort((a, b) => b.void - a.void)[0];
  const voidOk = !worstVoid || worstVoid.void <= thresholds.maxPaneVoidPx;
  checks.push({
    name: "layout-fit",
    ok: voidOk,
    detail: worstVoid
      ? `worst pane void ${Math.round(worstVoid.void)}px @ ${worstVoid.area} (source: ${paneSource}, max ${thresholds.maxPaneVoidPx})`
      : "no panes measured (tried [data-area], [data-fragment])",
  });

  // Core Web Vitals against the page's own declared budget. A metric with no
  // measurement or no ceiling is SKIPPED, so "nothing was compared" never
  // reads as "passed".
  for (const [name, measured, ceiling, unit] of [
    [
      "web-vitals-lcp",
      obs.webVitals?.lcpMs,
      obs.webVitals?.budget?.maxLCPMs,
      "ms",
    ],
    ["web-vitals-cls", obs.webVitals?.cls, obs.webVitals?.budget?.maxCLS, ""],
    [
      "web-vitals-ttfb",
      obs.webVitals?.ttfbMs,
      obs.webVitals?.budget?.maxTTFBMs,
      "ms",
    ],
  ] as Array<[string, number | undefined, number | undefined, string]>) {
    if (measured === undefined || ceiling === undefined) {
      checks.push({
        name,
        ok: true,
        skipped: true,
        detail:
          measured === undefined
            ? "not measured in this run"
            : `measured ${measured}${unit} but the page declares no ceiling`,
      });
      continue;
    }
    const rounded = unit === "ms" ? Math.round(measured) : measured;
    const over = measured > ceiling;
    const sources =
      over && name === "web-vitals-cls" && obs.webVitals?.clsSources?.length
        ? ` — shifted: ${obs.webVitals.clsSources.slice(0, 4).join(" | ")}`
        : "";
    checks.push({
      name,
      ok: !over,
      detail: `${rounded}${unit} vs budget ${ceiling}${unit}${sources}`,
    });
  }

  // No horizontal page overflow.
  checks.push({
    name: "no-horizontal-overflow",
    ok: obs.horizontalOverflowPx <= thresholds.maxHorizontalOverflowPx,
    detail: `${obs.horizontalOverflowPx}px (max ${thresholds.maxHorizontalOverflowPx})`,
  });

  // Interaction contract (optional; explicit about being conditional). Pages
  // without an order-book (every composed page except trade) report this as
  // `skipped: true` rather than omitting it, so a reader can tell "this
  // page's contract doesn't apply" apart from "this wasn't collected".
  if (obs.interaction) {
    checks.push({
      name: `interaction:${obs.interaction.name}`,
      ok: obs.interaction.skipped ? true : obs.interaction.ok,
      detail: obs.interaction.detail,
      skipped: obs.interaction.skipped,
    });
  }

  return { checks, ok: checks.every((c) => c.ok) };
}
