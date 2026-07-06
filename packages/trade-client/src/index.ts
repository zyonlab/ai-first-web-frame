/**
 * `@mvp/trade-client` — the single client-island runtime for the trade demo.
 *
 * This is the ONLY package that ships React to the browser (README §4.4 /
 * §11). It bundles three concerns so every island shares one chunk:
 *
 *  1. Island runtime — the frozen mount markup + snapshot contract
 *     (`mountIsland`, `registerIsland`, `hydrateIslands`, `readIslandSnapshot`).
 *  2. Store client — a generic `@mvp/interaction`-backed client store
 *     (`createTradeStore`, `useStoreSlice`).
 *  3. Chart adapter — a self-contained canvas 2D candle/depth renderer
 *     (`drawCandles`, `drawDepth`, `CandleChart`), also consumed by the trace
 *     UI (doc 08).
 *
 * See README.md in this package for the frozen contracts and usage.
 */

export {
  type Candle,
  CandleChart,
  type CandleChartProps,
  type ChartColors,
  type DepthBook,
  type DepthLevel,
  type DrawOptions,
  drawCandles,
  drawDepth,
  resolveChartColors,
  type StyleSource,
} from "./chart";
export {
  clearIslandRegistry,
  getIsland,
  hydrateIslands,
  type IslandComponent,
  type IslandHandle,
  type IslandSnapshot,
  type MountIslandOptions,
  mountIsland,
  readIslandSnapshot,
  registerIsland,
} from "./island";
export {
  type CreateTradeStoreOptions,
  createTradeStore,
  type TradeStore,
  useStoreSlice,
} from "./store";
