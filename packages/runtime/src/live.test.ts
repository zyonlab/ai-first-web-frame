/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type LivePanel,
  resolveSourceTemplate,
  startLivePanels,
  templateParams,
} from "./live";

/** A panel that records every mount context and frame it is handed. */
function recordingPanel(
  fragment: string,
  subscriptions: string[],
): LivePanel & {
  mounts: Array<{ remounted: boolean; params: Record<string, string> }>;
  frames: Array<{ source: string; data: unknown }>;
  stops: number;
} {
  const mounts: Array<{
    remounted: boolean;
    params: Record<string, string>;
  }> = [];
  const frames: Array<{ source: string; data: unknown }> = [];
  const state = { stops: 0 };
  return {
    fragment,
    subscriptions,
    mounts,
    frames,
    get stops() {
      return state.stops;
    },
    mount(ctx) {
      mounts.push({ remounted: ctx.remounted, params: { ...ctx.params } });
      return {
        onFrame(source, data) {
          frames.push({ source, data });
        },
        stop() {
          state.stops += 1;
        },
      };
    },
  };
}

/** A `subscribe` adapter that lets a test push frames by source id. */
function fakeBus() {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const live = new Set<string>();
  return {
    live,
    subscribe(source: string, onFrame: (data: unknown) => void) {
      live.add(source);
      const set = handlers.get(source) ?? new Set();
      set.add(onFrame);
      handlers.set(source, set);
      return () => {
        set.delete(onFrame);
        if (set.size === 0) live.delete(source);
      };
    },
    push(source: string, data: unknown) {
      for (const handler of handlers.get(source) ?? []) handler(data);
    },
  };
}

function root(...fragments: Array<{ name: string; fallback?: boolean }>) {
  const el = document.createElement("div");
  for (const fragment of fragments) {
    const node = document.createElement("section");
    node.setAttribute("data-fragment", fragment.name);
    if (fragment.fallback) node.setAttribute("data-fallback", "true");
    el.appendChild(node);
  }
  return el;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("templateParams", () => {
  it("returns the bound parameter names in first-appearance order", () => {
    expect(templateParams("candles.<symbol>.<interval>")).toEqual([
      "symbol",
      "interval",
    ]);
  });

  it("de-duplicates a parameter used twice", () => {
    expect(templateParams("x.<symbol>.y.<symbol>")).toEqual(["symbol"]);
  });

  it("returns nothing for a global source id", () => {
    expect(templateParams("positions")).toEqual([]);
  });
});

describe("resolveSourceTemplate", () => {
  it("substitutes every placeholder", () => {
    expect(
      resolveSourceTemplate("candles.<symbol>.<interval>", {
        symbol: "BTC",
        interval: "1m",
      }),
    ).toBe("candles.BTC.1m");
  });

  it("throws rather than subscribing to an unresolved id", () => {
    expect(() => resolveSourceTemplate("book.l2.<symbol>", {})).toThrow(
      /binds <symbol>/,
    );
  });
});

describe("startLivePanels — discovery", () => {
  it("mounts a declared panel and routes its frames", () => {
    const bus = fakeBus();
    const book = recordingPanel("order-book", ["book.l2.<symbol>"]);
    const controller = startLivePanels({
      root: root({ name: "order-book" }),
      panels: [book],
      params: { symbol: "BTC" },
      subscribe: bus.subscribe,
    });

    expect(controller.mounted).toEqual(["order-book"]);
    expect(book.mounts[0]).toEqual({
      remounted: false,
      params: { symbol: "BTC" },
    });

    bus.push("book.l2.BTC", { seq: 1 });
    expect(book.frames).toEqual([{ source: "book.l2.BTC", data: { seq: 1 } }]);
    controller.stop();
  });

  it("skips a fragment that did not render on this page", () => {
    const bus = fakeBus();
    const book = recordingPanel("order-book", ["book.l2.<symbol>"]);
    const controller = startLivePanels({
      root: root({ name: "trades-feed" }),
      panels: [book],
      params: { symbol: "BTC" },
      subscribe: bus.subscribe,
    });

    expect(controller.mounted).toEqual([]);
    expect(bus.live.size).toBe(0);
    controller.stop();
  });

  it("skips a fragment that rendered its fallback", () => {
    const bus = fakeBus();
    const book = recordingPanel("order-book", ["book.l2.<symbol>"]);
    const controller = startLivePanels({
      root: root({ name: "order-book", fallback: true }),
      panels: [book],
      params: { symbol: "BTC" },
      subscribe: bus.subscribe,
    });

    expect(controller.mounted).toEqual([]);
    controller.stop();
  });

  it("isolates a panel that throws at mount from the rest of the page", () => {
    const bus = fakeBus();
    const onError = vi.fn();
    const broken: LivePanel = {
      fragment: "order-book",
      subscriptions: ["book.l2.<symbol>"],
      mount() {
        throw new Error("boom");
      },
    };
    const tape = recordingPanel("trades-feed", ["trades.<symbol>"]);
    const controller = startLivePanels({
      root: root({ name: "order-book" }, { name: "trades-feed" }),
      panels: [broken, tape],
      params: { symbol: "BTC" },
      subscribe: bus.subscribe,
      onError,
    });

    expect(controller.mounted).toEqual(["trades-feed"]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      fragment: "order-book",
      phase: "mount",
    });
    controller.stop();
  });

  it("keeps a panel live after one of its frames throws", () => {
    const bus = fakeBus();
    const onError = vi.fn();
    let calls = 0;
    const flaky: LivePanel = {
      fragment: "order-book",
      subscriptions: ["book.l2.<symbol>"],
      mount: () => ({
        onFrame() {
          calls += 1;
          if (calls === 1) throw new Error("bad frame");
        },
      }),
    };
    const controller = startLivePanels({
      root: root({ name: "order-book" }),
      panels: [flaky],
      params: { symbol: "BTC" },
      subscribe: bus.subscribe,
      onError,
    });

    bus.push("book.l2.BTC", {});
    bus.push("book.l2.BTC", {});
    expect(calls).toBe(2);
    expect(onError).toHaveBeenCalledTimes(1);
    controller.stop();
  });
});

describe("startLivePanels — parameter changes", () => {
  it("re-subscribes bound panels to the new source id", () => {
    const bus = fakeBus();
    const book = recordingPanel("order-book", ["book.l2.<symbol>"]);
    const controller = startLivePanels({
      root: root({ name: "order-book" }),
      panels: [book],
      params: { symbol: "BTC" },
      subscribe: bus.subscribe,
    });

    controller.setParams({ symbol: "ETH" });
    expect([...bus.live]).toEqual(["book.l2.ETH"]);

    bus.push("book.l2.BTC", { stale: true });
    expect(book.frames).toEqual([]);
    bus.push("book.l2.ETH", { fresh: true });
    expect(book.frames).toEqual([
      { source: "book.l2.ETH", data: { fresh: true } },
    ]);
    controller.stop();
  });

  it("marks a panel remounted only when a parameter IT binds changed", () => {
    const bus = fakeBus();
    const book = recordingPanel("order-book", ["book.l2.<symbol>"]);
    const positions = recordingPanel("positions-table", ["positions"]);
    const controller = startLivePanels({
      root: root({ name: "order-book" }, { name: "positions-table" }),
      panels: [book, positions],
      params: { symbol: "BTC" },
      subscribe: bus.subscribe,
    });

    controller.setParams({ symbol: "ETH" });

    // The book's rendered rows hold BTC prices — stale.
    expect(book.mounts.map((m) => m.remounted)).toEqual([false, true]);
    // `positions` is a global source; its rows survive the symbol switch.
    expect(positions.mounts.map((m) => m.remounted)).toEqual([false, false]);
    controller.stop();
  });

  it("is a no-op when the parameters are unchanged", () => {
    const bus = fakeBus();
    const book = recordingPanel("order-book", ["book.l2.<symbol>"]);
    const controller = startLivePanels({
      root: root({ name: "order-book" }),
      panels: [book],
      params: { symbol: "BTC" },
      subscribe: bus.subscribe,
    });

    controller.setParams({ symbol: "BTC" });
    expect(book.mounts).toHaveLength(1);
    controller.stop();
  });

  it("lets the page rotate its client before panels re-subscribe", () => {
    const bus = fakeBus();
    const order: string[] = [];
    const book: LivePanel = {
      fragment: "order-book",
      subscriptions: ["book.l2.<symbol>"],
      mount: (ctx) => {
        order.push(`mount:${ctx.params.symbol}`);
        return { onFrame() {} };
      },
    };
    const controller = startLivePanels({
      root: root({ name: "order-book" }),
      panels: [book],
      params: { symbol: "BTC" },
      subscribe: bus.subscribe,
      onParamsChange: (next) => order.push(`rotate:${next.symbol}`),
    });

    controller.setParams({ symbol: "ETH" });
    expect(order).toEqual(["mount:BTC", "rotate:ETH", "mount:ETH"]);
    controller.stop();
  });
});

describe("startLivePanels — teardown", () => {
  it("cancels every subscription and stops every panel", () => {
    const bus = fakeBus();
    const book = recordingPanel("order-book", ["book.l2.<symbol>"]);
    const positions = recordingPanel("positions-table", ["positions"]);
    const controller = startLivePanels({
      root: root({ name: "order-book" }, { name: "positions-table" }),
      panels: [book, positions],
      params: { symbol: "BTC" },
      subscribe: bus.subscribe,
    });

    controller.stop();
    expect(bus.live.size).toBe(0);
    expect(book.stops).toBe(1);
    expect(positions.stops).toBe(1);

    bus.push("positions", {});
    expect(positions.frames).toEqual([]);
  });

  it("ignores a second stop and a setParams after stop", () => {
    const bus = fakeBus();
    const book = recordingPanel("order-book", ["book.l2.<symbol>"]);
    const controller = startLivePanels({
      root: root({ name: "order-book" }),
      panels: [book],
      params: { symbol: "BTC" },
      subscribe: bus.subscribe,
    });

    controller.stop();
    controller.stop();
    controller.setParams({ symbol: "ETH" });
    expect(book.stops).toBe(1);
    expect(book.mounts).toHaveLength(1);
  });
});
