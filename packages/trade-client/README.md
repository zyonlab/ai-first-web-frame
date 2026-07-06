# @mvp/trade-client

The **single client-island runtime** for the trade demo. This is the ONLY package
that ships React to the browser (spine README §4.4 / §11); every island mounts
through it so React/React-DOM bundle exactly once. Three concerns live here:

1. **Island runtime** — the frozen mount markup + snapshot contract.
2. **Store client** — a generic `@mvp/interaction`-backed client store.
3. **Chart adapter** — a self-contained canvas 2D candle/depth renderer (no
   external charting dependency, per README §14 **D2**).

---

## 1. Island mount contract (FROZEN — C2 / README §14 D4)

Fragment agents MUST emit this exact markup for every hydratable sub-part. The
shape is frozen; `mountIsland` reads it verbatim.

```html
<div data-island="<name>">
  <!-- server-rendered first paint, fully readable with JS disabled -->
  <script type="application/json" data-island-props="<name>">
    { "props": { "symbol": "BTC", "levels": [] }, "slice": "orderDraft" }
  </script>
</div>
```

Rules:

- The mount node is `<div data-island="<name>">`. `<name>` is the stable island
  id used with `registerIsland(name, Component)` (e.g. `chart`, `book`,
  `trades`, `orderForm`, `accountBar`, `positions`, `openOrders`,
  `marketHeader`, `rail`).
- The snapshot is an **inline** `<script type="application/json">` that is a
  child of the mount node (the `data-island-props` attribute is optional/
  informational; `mountIsland` matches by `type="application/json"`).
- The JSON is an `IslandSnapshot`: `{ props: {...}, slice?: "<sliceName>" }`.
  `props` is handed to the island component on mount; `slice` (optional) names
  the store slice the island reads/writes.
- Missing or malformed JSON degrades to `{ props: {} }` — a broken snapshot
  never crashes hydration; the SSR first paint simply stays static.

### API

```ts
// Frozen signatures — fragment/page agents consume these unchanged.
function mountIsland(
  el: HTMLElement,
  opts?: { props?: Record<string, unknown>; slice?: string },
): { unmount(): void };

function registerIsland(name: string, Component: IslandComponent): void;
function hydrateIslands(root?: ParentNode): IslandHandle[]; // scans [data-island]
function readIslandSnapshot(el: Element): IslandSnapshot;   // parses inline JSON
function clearIslandRegistry(): void;                        // test/HMR helper
```

- `mountIsland(el, opts)` — resolves the component from the registry by the
  node's `data-island` name, merges `opts` over the inline snapshot (explicit
  `opts` win), and mounts with `react-dom/client` `createRoot`. Returns a handle
  whose `unmount()` disposes the root. **Throws** when the node has no
  `data-island` name or the name is unregistered (authoring errors).
- `hydrateIslands(root?)` — scans `root` (default `document`) for every
  `[data-island]` node and mounts each **registered** one; unregistered nodes
  are skipped (not thrown) so one missing island can't break the page.

### Usage (page/fragment agents)

```ts
import { registerIsland, hydrateIslands } from "@mvp/trade-client";
import { OrderForm } from "./islands/OrderForm";

registerIsland("orderForm", OrderForm);
// ...register the other islands, then:
hydrateIslands(); // mounts every [data-island] with a registered component
```

The island component receives `{ ...snapshot.props, slice }` as its props.

---

## 2. Store client

A **generic** client store over `@mvp/interaction`. It is generic over the slice
map and does **not** hard-code concrete slices — the concrete
`InteractionContract`s (activeSymbol, orderDraft, chartInterval, hoveredPrice,
bookGrouping) are defined by the P1 data agent and passed in at construction.

**Convention: the slice name IS the interaction channel name.** Provide one
`InteractionContract` per slice whose `channel` equals the slice key, and whose
`publisher`/`subscribers` include the store `owner` (default `"trade-store"`).

```ts
import { createTradeStore, useStoreSlice } from "@mvp/trade-client";

type Slices = { activeSymbol: string; orderDraft: OrderDraft /* ... */ };

const store = createTradeStore<Slices>(tradeContracts, {
  initial: { activeSymbol: "BTC", orderDraft: defaultDraft },
  owner: "trade-store", // optional; must match the contracts' publisher/subscribers
});

store.get("activeSymbol");            // "BTC"
await store.set("activeSymbol", "ETH"); // publishes + notifies subscribers
const unsub = store.subscribe("orderDraft", (draft) => { /* ... */ });

// React hook (useSyncExternalStore-based, SSR-render safe):
const symbol = useStoreSlice(store, "activeSymbol");
```

- `get` / `set` / `subscribe` throw if a slice has no declared contract (same
  contract discipline `@mvp/interaction` enforces — typos surface immediately).
- **SSR-safe**: holds state in memory, never touches `window`/`document`, so it
  can be constructed on the server; `useStoreSlice` uses `useSyncExternalStore`
  with a server snapshot.

---

## 3. Chart adapter (canvas 2D, D2)

Pure canvas 2D — no `uPlot`/`lightweight-charts` or any external charting dep.
The same `drawCandles` / `drawDepth` functions are the adapter interface the
trace UI (doc 08) also consumes.

```ts
import {
  drawCandles, drawDepth, resolveChartColors, CandleChart,
  type Candle, type DepthBook, type ChartColors,
} from "@mvp/trade-client";

// Low-level renderers (unit-testable with a mock CanvasRenderingContext2D):
drawCandles(ctx, series /* Candle[] */, { width, height, padding?, colors? });
drawDepth(ctx, book /* DepthBook */,    { width, height, padding?, colors? });

// React wrapper (holds a <canvas> via ref, redraws on change):
<CandleChart series={candles} interval="1m" width={320} height={160} />;
```

Types:

```ts
interface Candle { time: number; open: number; high: number; low: number; close: number; }
interface DepthLevel { price: number; size: number; }
interface DepthBook { bids: DepthLevel[]; asks: DepthLevel[]; }
interface DrawOptions { width: number; height: number; padding?: number; colors?: ChartColors; }
interface ChartColors { buy: string; sell: string; grid: string; text: string; }
```

**Theming.** `resolveChartColors(styleSource)` reads CSS variables
`--mvp-color-buy`, `--mvp-color-sell`, `--mvp-color-grid`, `--mvp-color-text`
from a style source (typically `getComputedStyle(canvas)`), falling back to
built-in defaults for any missing token — so the chart follows the active theme
and works even before the design-system tokens are wired. `CandleChart` resolves
colors from the canvas's computed style automatically.

- `drawCandles`: clears once, then one filled body rect + one wick line
  (`moveTo`/`lineTo`) per candle; up candles (`close >= open`) use `buy`, down
  candles use `sell`. Y maps the global `[low, high]` extent onto the padded
  height (inverted). Empty series → clears only.
- `drawDepth`: one filled cumulative step area per side — bids from mid→left in
  `buy`, asks from mid→right in `sell`. Empty book → clears only.

---

## 4. Testing

```bash
pnpm -w exec vitest run packages/trade-client/src
```

Environment is happy-dom. Note: happy-dom does not implement
`HTMLCanvasElement.getContext`, so the `drawCandles`/`drawDepth` functions are
tested against a **mock `CanvasRenderingContext2D`** (asserting draw-call counts
and key coordinates); the `CandleChart` wrapper guards `getContext` absence and
is tested only for its DOM shape.
