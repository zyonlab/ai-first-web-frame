import { createSliceStore, type SliceStore } from "@mvp/store";
import {
  initialTradeSlices,
  TRADE_ACTIVE_SYMBOL,
  TRADE_STORE_OWNER,
  type TradeSlices,
  tradeStoreContracts,
} from "@mvp/trade-contracts";
import type { MockScheduler } from "@mvp/trade-data";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTradeRealtime } from "./realtime";

/**
 * A manual scheduler: captures every `setInterval` callback the mock transports
 * register so a test drives frames deterministically. Subscription delivery is
 * async (the client awaits a cache write before invoking the handler), so
 * `advance()` fires each tick then flushes microtasks.
 */
function createManualScheduler() {
  const ticks = new Set<() => void>();
  const scheduler: MockScheduler = {
    setInterval(fn) {
      ticks.add(fn);
      return {
        clear() {
          ticks.delete(fn);
        },
      };
    },
  };
  return {
    scheduler,
    /** Fire one tick for every live feed, then let async delivery settle. */
    async advance() {
      for (const fn of [...ticks]) fn();
      // Two microtask turns cover deliver()'s awaited cache write + handler.
      await Promise.resolve();
      await Promise.resolve();
    },
    get size() {
      return ticks.size;
    },
    /** The current set of live tick callbacks (identity-comparable in tests). */
    rawTicks() {
      return [...ticks];
    },
  };
}

function makeStore(): SliceStore<TradeSlices> {
  return createSliceStore<TradeSlices>(tradeStoreContracts, {
    initial: structuredClone(initialTradeSlices),
    owner: TRADE_STORE_OWNER,
  });
}

/** SSR order-book markup. Spread strip is what the live frame always repaints. */
function orderBookHtml(): string {
  const row = (side: "bid" | "ask", key: string, price: number) =>
    `<tr class="ob-row ob-${side}" data-price="${key}" data-side="${side}" style="--depth:0%">` +
    `<td class="ob-price" data-field="price" data-value="${price}">${price}</td>` +
    `<td class="ob-num" data-field="size">1.000</td>` +
    `<td class="ob-num" data-field="total">1.000</td>` +
    `</tr>`;
  return (
    `<section class="ob" data-fragment="order-book" data-symbol="BTC" data-seq="0">` +
    `<table class="ob-table">` +
    `<tbody class="ob-asks" data-side="ask">${row("ask", "64010", 64010)}</tbody>` +
    `<tbody class="ob-spread"><tr><td colspan="3"><span data-field="spread">0.0</span> <span data-field="spread-pct">(0.000%)</span> <span data-field="mid">0.0</span></td></tr></tbody>` +
    `<tbody class="ob-bids" data-side="bid">${row("bid", "64000", 64000)}</tbody>` +
    `</table>` +
    `</section>`
  );
}

/** SSR trades-feed markup with an EMPTY body so the first live print prepends. */
function tradesHtml(): string {
  return (
    `<section data-fragment="trades-feed" data-symbol="BTC" data-limit="30">` +
    `<table class="trades-tape">` +
    `<tbody data-trades-body></tbody>` +
    `</table>` +
    `</section>`
  );
}

/** SSR positions-table markup with one seeded BTC row (zero values). */
function positionsHtml(): string {
  return (
    `<section class="pt" data-fragment="positions-table">` +
    `<table class="pt-table">` +
    `<tbody data-positions-body>` +
    `<tr class="pt-row pt-row--long" data-symbol="BTC" data-direction="long" role="row">` +
    `<td class="pt-cell pt-cell--symbol" data-field="symbol">BTC</td>` +
    `<td class="pt-cell pt-cell--side pt-side--long" data-field="direction">LONG</td>` +
    `<td class="pt-cell pt-cell--num" data-field="size">0.0000</td>` +
    `<td class="pt-cell pt-cell--num" data-field="entry">0.00</td>` +
    `<td class="pt-cell pt-cell--num" data-field="mark">0.00</td>` +
    `<td class="pt-cell pt-cell--num" data-field="liq">0.00</td>` +
    `<td class="pt-cell pt-cell--num pt-pnl pt-pnl--up" data-field="pnl" data-sign="up">+0.00</td>` +
    `<td class="pt-cell pt-cell--action"><button type="button" class="pt-close" data-action="close" data-symbol="BTC">Close</button></td>` +
    `</tr>` +
    `</tbody>` +
    `</table>` +
    `</section>`
  );
}

function mountPage(symbol = "BTC"): HTMLElement {
  const main = document.createElement("main");
  main.setAttribute("data-page", "trade");
  main.setAttribute("data-symbol", symbol);
  main.innerHTML = orderBookHtml() + tradesHtml() + positionsHtml();
  document.body.appendChild(main);
  return main;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("startTradeRealtime — frame application", () => {
  it("prepends a new trades row when a frame is pushed", async () => {
    const store = makeStore();
    const main = mountPage();
    const manual = createManualScheduler();
    const teardown = startTradeRealtime(main, store, {
      transportScheduler: manual.scheduler,
    });

    const body = main.querySelector("[data-trades-body]") as Element;
    expect(body.querySelectorAll("[data-seq]").length).toBe(0);
    await manual.advance();
    // A new print was prepended at the head (newest-first).
    expect(body.querySelectorAll("[data-seq]").length).toBe(1);
    expect(body.firstElementChild?.getAttribute("data-side")).toMatch(
      /buy|sell/,
    );

    teardown();
  });

  it("repaints the order-book spread strip on a new book frame", async () => {
    const store = makeStore();
    const main = mountPage();
    const manual = createManualScheduler();
    const teardown = startTradeRealtime(main, store, {
      transportScheduler: manual.scheduler,
    });

    const book = main.querySelector('[data-fragment="order-book"]') as Element;
    const spread = () =>
      book.querySelector('[data-field="spread"]')?.textContent;
    expect(spread()).toBe("0.0");
    await manual.advance();
    // The live frame's real spread replaced the seeded placeholder.
    expect(spread()).not.toBe("0.0");

    teardown();
  });

  it("upserts positions rows on the polled positions frame", async () => {
    vi.useFakeTimers();
    const store = makeStore();
    const main = mountPage();
    const manual = createManualScheduler();
    const teardown = startTradeRealtime(main, store, {
      transportScheduler: manual.scheduler,
    });

    const body = main.querySelector("[data-positions-body]") as Element;
    const btcPnl = () =>
      body.querySelector('[data-symbol="BTC"] [data-field="pnl"]')?.textContent;
    expect(btcPnl()).toBe("+0.00");
    // positions rides the core poll loop (no mock transport): flush the initial
    // poll + its async fixture load.
    await vi.advanceTimersByTimeAsync(0);
    // BTC row patched to its real uPnL; the ETH position was inserted.
    expect(btcPnl()).toBe("+60.00");
    expect(body.querySelector('[data-symbol="ETH"]')).not.toBeNull();

    teardown();
  });
});

describe("startTradeRealtime — symbol switch", () => {
  it("re-subscribes for the new symbol and keeps driving the DOM", async () => {
    const store = makeStore();
    const main = mountPage("BTC");
    const manual = createManualScheduler();
    const teardown = startTradeRealtime(main, store, {
      transportScheduler: manual.scheduler,
    });

    const btcFeeds = manual.size;
    expect(btcFeeds).toBeGreaterThan(0);

    // Capture the BTC feed callbacks, switch symbol, and confirm the OLD feeds
    // were cleared (a fresh set of live feeds now drives the ETH streams).
    const btcTickHandles = new Set(manual.rawTicks());
    await store.set(TRADE_ACTIVE_SYMBOL, { symbol: "ETH" });

    // Old feeds torn down and re-registered for ETH (same live-feed count, but
    // none of the original BTC tick callbacks survive).
    expect(manual.size).toBe(btcFeeds);
    for (const fn of manual.rawTicks())
      expect(btcTickHandles.has(fn)).toBe(false);

    // The ETH order-book stream is live: a frame repaints the spread strip
    // (row-key-agnostic, so no seq/price-collision fragility across the switch).
    const book = main.querySelector('[data-fragment="order-book"]') as Element;
    (book.querySelector('[data-field="spread"]') as Element).textContent =
      "0.0";
    await manual.advance();
    expect(book.querySelector('[data-field="spread"]')?.textContent).not.toBe(
      "0.0",
    );

    teardown();
  });
});

describe("startTradeRealtime — teardown", () => {
  it("cancels every subscription so no frames apply after teardown", async () => {
    const store = makeStore();
    const main = mountPage();
    const manual = createManualScheduler();
    const teardown = startTradeRealtime(main, store, {
      transportScheduler: manual.scheduler,
    });

    await manual.advance();
    const body = main.querySelector("[data-trades-body]") as Element;
    const afterOne = body.querySelectorAll("[data-seq]").length;
    expect(afterOne).toBeGreaterThan(0);

    teardown();
    // Every mock-transport feed was cleared: nothing left to tick.
    expect(manual.size).toBe(0);
    await manual.advance();
    expect(body.querySelectorAll("[data-seq]").length).toBe(afterOne);

    // The store listener was removed too: a later symbol switch does not re-wire.
    await store.set(TRADE_ACTIVE_SYMBOL, { symbol: "ETH" });
    expect(manual.size).toBe(0);
  });
});
