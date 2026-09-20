/**
 * @vitest-environment happy-dom
 *
 * The page ↔ fragment realtime contract.
 *
 * Realtime subscriptions are declared by each FRAGMENT (in its manifest) and
 * resolved by a generic driver, so the page no longer knows what any panel
 * listens to. These tests guard the two seams that replaces:
 *
 * 1. Every declared template must resolve to a source id the data layer
 *    actually serves — a typo like `book.12.<symbol>` would subscribe happily
 *    and then never deliver a frame.
 * 2. The page must supply every parameter its panels bind. A fragment that
 *    ships a new version subscribing to `candles.<symbol>.<interval>` would
 *    otherwise mount silently and never receive a frame; here it fails loudly.
 */

import { positionsTableLivePanel } from "@mvp/fragment-positions-table/live";
import {
  type LivePanel,
  resolveSourceTemplate,
  templateParams,
} from "@mvp/runtime/live";
import { createSliceStore } from "@mvp/store";
import {
  initialTradeSlices,
  TRADE_STORE_OWNER,
  type TradeSlices,
  tradeStoreContracts,
} from "@mvp/trade-contracts";
import { parseSourceId } from "@mvp/trade-data";
import { describe, expect, it } from "vitest";
import { startTradeRealtime, TRADE_LIVE_PANELS } from "./realtime";

/** The parameters this page can bind (see `startTradeRealtime`). */
const PAGE_PARAMS = ["symbol"];

/** A representative binding for every parameter the page can supply. */
const SAMPLE_PARAMS = { symbol: "BTC" };

describe("live panels ↔ the data layer", () => {
  it("declares at least one subscription per panel", () => {
    for (const panel of TRADE_LIVE_PANELS) {
      expect(panel.subscriptions.length).toBeGreaterThan(0);
    }
  });

  it("declares only templates that resolve to a known C5 source id", () => {
    const unknown = TRADE_LIVE_PANELS.flatMap((panel) =>
      panel.subscriptions
        .map((template) => resolveSourceTemplate(template, SAMPLE_PARAMS))
        .filter((id) => parseSourceId(id) === undefined)
        .map((id) => `${panel.fragment}: ${id}`),
    );
    expect(unknown).toEqual([]);
  });

  it("composes exactly the panels the page registered", () => {
    expect(TRADE_LIVE_PANELS.map((p) => p.fragment)).toEqual([
      "order-book",
      "trades-feed",
      "positions-table",
    ]);
  });
});

describe("page supplies every bound parameter", () => {
  it("binds no parameter the trade page cannot resolve", () => {
    const bound = new Set(
      TRADE_LIVE_PANELS.flatMap((panel) =>
        panel.subscriptions.flatMap(templateParams),
      ),
    );
    expect([...bound].filter((name) => !PAGE_PARAMS.includes(name))).toEqual(
      [],
    );
  });

  it("keeps the positions panel on a parameter-free source", () => {
    // This is load-bearing: it is why open positions survive a symbol switch.
    expect(
      positionsTableLivePanel.subscriptions.flatMap(templateParams),
    ).toEqual([]);
  });
});

describe("a new live fragment needs no driver or page change", () => {
  it("mounts a panel the page has never heard of and routes its frames", () => {
    // Stands in for a freshly deployed fragment: it declares a subscription in
    // the same template vocabulary and ships a mount function. Nothing in
    // `@mvp/runtime/live` or the page's wiring knows this fragment exists.
    const frames: unknown[] = [];
    const newcomer: LivePanel = {
      fragment: "funding-bar",
      subscriptions: ["funding.<symbol>"],
      mount: () => ({ onFrame: (_source, data) => frames.push(data) }),
    };

    const root = document.createElement("div");
    root.setAttribute("data-page", "trade");
    root.setAttribute("data-symbol", "BTC");
    const node = document.createElement("section");
    node.setAttribute("data-fragment", "funding-bar");
    root.appendChild(node);

    const store = createSliceStore<TradeSlices>(tradeStoreContracts, {
      initial: structuredClone(initialTradeSlices),
      owner: TRADE_STORE_OWNER,
    });

    // A holder rather than two `let`s: TypeScript narrows a local assigned
    // only inside a callback to its initializer type.
    const feed: {
      subscribed: string | null;
      push: ((data: unknown) => void) | null;
    } = { subscribed: null, push: null };

    const stop = startTradeRealtime(root, store, {
      panels: [newcomer],
      createClient: () =>
        ({
          subscribe: (id: string, handler: (e: { data: unknown }) => void) => {
            feed.subscribed = id;
            feed.push = (data) => handler({ data });
            return () => {
              feed.push = null;
            };
          },
        }) as never,
    });

    expect(feed.subscribed).toBe("funding.BTC");
    feed.push?.({ rate: 0.0001 });
    expect(frames).toEqual([{ rate: 0.0001 }]);

    stop();
    expect(feed.push).toBeNull();
  });
});
