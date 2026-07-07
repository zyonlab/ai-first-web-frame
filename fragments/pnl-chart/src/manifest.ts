import { pnlChartBudget } from "./budget";

/**
 * pnl-chart fragment manifest (A2-pnl slot, portfolio page).
 *
 * Pure SSR inline-SVG equity/PnL curve, no React island. The curve is derived
 * deterministically from a candle history (see `data.ts`) so it is cache-stable;
 * `isr` with a 60s TTL matches the portfolio page's "recompute periodically, not
 * per request" cadence. Assets are a single scoped CSS sheet and ZERO JS — the
 * `<polyline>` is server-rendered and readable with JavaScript disabled.
 *
 * Data dependency: the equity curve is synthesized from the frozen C4 client's
 * `candles.history.<symbol>.<interval>` source (contract C5). We surface it under
 * the logical id `pnl.history` in `dataDependencies` (the runtime dep-graph label
 * for this slot); the underlying read is the deterministic candle-history frame.
 */
export const pnlChartManifest = {
  name: "pnl-chart",
  owner: "portfolio",
  version: "0.1.0",
  renderMode: "ssr",
  renderStrategy: "isr",
  cachePolicy: {
    // Equity curve is deterministic + slow-moving: revalidate periodically.
    ttl: 60,
    tags: ["pnl"],
    vary: ["props"],
  },
  endpoint: "/render",
  fallback:
    '<section data-fragment="pnl-chart" data-fallback="true">PnL chart unavailable</section>',
  assets: {
    // Pure SSR SVG: no framework JS. An optional hover-readout island is a P3
    // enhancement shipped as a built client asset, not part of the fragment.
    js: [],
    css: ["/assets/pnl-chart.css"],
  },
  budget: pnlChartBudget,
  // Logical dep id for the dependency graph; resolved from the C4 client's
  // `candles.history.<symbol>.<interval>` source (see data.ts).
  dataDependencies: ["pnl.history"],
  metadata: {
    category: "trading",
    description:
      "SSR equity/PnL curve: hand-rolled SVG polyline, up/down fill, latest + period-return labels (no island)",
  },
} as const;

export function validatePnlChartManifest(manifest = pnlChartManifest): boolean {
  return Boolean(
    manifest.name &&
      manifest.owner &&
      manifest.version &&
      manifest.renderMode &&
      manifest.fallback &&
      manifest.assets &&
      manifest.budget,
  );
}
