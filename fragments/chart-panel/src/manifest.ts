import { sourceIds } from "@mvp/data";
import { chartPanelBudget } from "./budget";

/**
 * chart-panel fragment manifest (A2-chart). Mirrors the market-header /
 * order-form manifest shape and is validated by {@link validateChartPanelManifest}.
 *
 * - `renderStrategy: "isr"` — the candle **history** bootstrap (C5
 *   `candles.history.<symbol>.<interval>`) is ISR with a short 60s TTL; the
 *   near-realtime latest candle (`candles.<symbol>.<interval>`) is streamed by
 *   the island on top, so the SSR snapshot never blocks on live data.
 * - `assets.js` lists the shared client chunks as **shared dependencies** rather
 *   than re-bundling them: `@mvp/trade-client` carries React + the island
 *   runtime + the canvas candle renderer (`drawCandles` / `CandleChart`, README
 *   §14 D2), and `@mvp/ui/shadcn` carries the vendored Radix Tabs interval
 *   control. `@mvp/assets` dedupes both so React/canvas ship exactly once for
 *   the whole page (spine §4/§11 / D3). The fragment's own JS is only the island
 *   glue that hydrates the `data-island="chart"` mount node. No external chart
 *   library (uPlot / lightweight-charts) is used.
 * - `dataDependencies` declares the history bootstrap id and the live candle id
 *   for the default (symbol, interval); the slot re-resolves them per active
 *   symbol / interval.
 */
export const DEFAULT_SYMBOL = "BTC";
export const DEFAULT_INTERVAL = "1m";

export const chartPanelManifest = {
  name: "chart-panel",
  owner: "market-data",
  version: "0.1.0",
  renderMode: "ssr",
  renderStrategy: "isr",
  cachePolicy: {
    // ISR history bootstrap: short TTL so the SSR candle series is fresh while
    // the island streams the latest live candle on top.
    ttl: 60,
    tags: ["candles", "chart-panel"],
    vary: ["locale", "props"],
  },
  endpoint: "/render",
  fallback:
    '<section data-fragment="chart-panel" data-fallback="true">Chart unavailable</section>',
  assets: {
    // Shared React + canvas renderer chunk + shadcn interval control (deduped by
    // @mvp/assets) + the small island glue this fragment owns.
    js: [
      "@mvp/trade-client",
      "@mvp/ui/shadcn",
      "/assets/chart-panel.island.js",
    ],
    css: ["/assets/chart-panel.css"],
  },
  budget: chartPanelBudget,
  dataDependencies: [
    sourceIds.candlesHistory(DEFAULT_SYMBOL, DEFAULT_INTERVAL),
    sourceIds.candles(DEFAULT_SYMBOL, DEFAULT_INTERVAL),
  ],
  metadata: {
    category: "trading",
    description:
      "ISR candlestick chart (K-line) with interval control; canvas island renders history bootstrap + streams the live candle",
  },
} as const;

export function validateChartPanelManifest(
  manifest = chartPanelManifest,
): boolean {
  return Boolean(
    manifest.name &&
      manifest.owner &&
      manifest.version &&
      manifest.renderMode &&
      manifest.fallback &&
      manifest.assets &&
      manifest.budget &&
      Array.isArray(manifest.dataDependencies) &&
      manifest.dataDependencies.length > 0,
  );
}
