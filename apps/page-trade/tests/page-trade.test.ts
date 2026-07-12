import { clearFragmentCache } from "@mvp/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as healthGet } from "../app/health/route";
import { tradePageBudget } from "../src/budget";
import {
  fetchTradeFragmentSlots,
  normalizeSymbol,
  type TradeSlotKey,
} from "../src/fragmentSlots";
import { TRADE_GRID_CLASS } from "../src/gridStyles";
import { tradePageManifest, validateTradePageManifest } from "../src/manifest";
import { metadata } from "../src/metadata";
import { renderTradeHtml, tradeSeoCopy, usedUiComponents } from "../src/render";

/** The nine registered canary fragments the trade page composes. */
const FRAGMENT_PORTS: Record<string, TradeSlotKey> = {
  "4203": "marketHeader",
  "4211": "chart",
  "4204": "book",
  "4206": "trades",
  "4205": "orderForm",
  "4208": "positions",
  "4209": "openOrders",
  "4207": "accountBar",
  "4210": "fundingBar",
};

const FRAGMENT_NAME_BY_PORT: Record<string, string> = {
  "4203": "market-header",
  "4211": "chart-panel",
  "4204": "order-book",
  "4206": "trades-feed",
  "4205": "order-form",
  "4208": "positions-table",
  "4209": "open-orders",
  "4207": "account-bar",
  "4210": "funding-bar",
};

function portOf(url: string): string {
  const match = url.match(/:(\d+)\//);
  return match?.[1] ?? "";
}

/** Mock fetch that returns each fragment's sample SSR HTML keyed by port. */
function makeFragmentFetch(): typeof fetch {
  return (async (url: string | URL | Request) => {
    const port = portOf(String(url));
    const name = FRAGMENT_NAME_BY_PORT[port] ?? "unknown-fragment";
    return new Response(
      JSON.stringify({
        html: `<section data-fragment="${name}">${name} live</section>`,
        assets: { js: [], css: [] },
        cache: { ttl: 5, tags: [name] },
        metadata: { name, version: "0.1.0" },
      }),
    );
  }) as typeof fetch;
}

describe("page-trade", () => {
  beforeEach(() => {
    clearFragmentCache();
  });

  it("SSR HTML is no-JS readable and carries SEO copy + the symbol", () => {
    const html = renderTradeHtml("btc");
    expect(html).toContain('data-page="trade"');
    expect(html).toContain('data-symbol="BTC"');
    // Panels render readable fallbacks with no fragment data present.
    expect(html).toContain("Order book for BTC is loading.");
    expect(html).toContain("Account summary is loading.");
  });

  it("renders every named grid area from 01-ui-layout.md §1.2", () => {
    const html = renderTradeHtml("ETH");
    for (const area of [
      "rail",
      "header",
      "chart",
      "book",
      "trades",
      "form",
      "ledger",
      "status",
    ]) {
      expect(html).toContain(`data-area="${area}"`);
    }
    expect(html).toContain(`class="${TRADE_GRID_CLASS}"`);
  });

  it("renders the chart-panel area, falling back readably when absent", () => {
    const html = renderTradeHtml("BTC");
    expect(html).toContain('data-slot="chart"');
    // No fragment data present -> readable, no-JS fallback (not a hard blank).
    expect(html).toContain("Chart for BTC is loading.");
  });

  it("metadata includes title and description", () => {
    expect(metadata).toMatchObject({
      title: tradePageManifest.seo.title,
      description: tradePageManifest.seo.description,
    });
    expect(tradeSeoCopy.title).toBe(tradePageManifest.seo.title);
  });

  it("page manifest passes validation and lists 9 slots", () => {
    expect(validateTradePageManifest()).toBe(true);
    expect(tradePageManifest.slots).toHaveLength(9);
    for (const slot of tradePageManifest.slots) {
      expect(slot.channel).toBe("canary");
    }
    const required = tradePageManifest.slots.filter((s) => s.required);
    expect(required.map((s) => s.name)).toEqual(["marketHeader"]);
  });

  it("declares page budget and UI component usage", () => {
    expect(tradePageBudget.scope).toBe("page");
    // 220000 = measured gzipped first-load baseline (202KB: React + shared
    // vendor + every trade island's glue, by D3 design) + headroom — see the
    // calibration comment in src/budget.ts; audit:bundle gates the real
    // number against this ceiling.
    expect(tradePageBudget.jsBytes).toBeLessThanOrEqual(220000);
    expect(tradePageBudget.cssBytes).toBeLessThanOrEqual(50000);
    expect(usedUiComponents).toContain("DataTable");
  });

  it("health route returns page-trade ok", async () => {
    const res = await healthGet();
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      service: "page-trade",
    });
  });

  it("normalizes the route symbol (upper-cases, defaults to BTC)", () => {
    expect(normalizeSymbol("eth")).toBe("ETH");
    expect(normalizeSymbol("  sol ")).toBe("SOL");
    expect(normalizeSymbol("")).toBe("BTC");
    expect(normalizeSymbol(undefined)).toBe("BTC");
  });

  it("composes all 9 canary fragment slots through registry render endpoints", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return makeFragmentFetch()(url);
    }) as typeof fetch;

    const result = await fetchTradeFragmentSlots({
      symbol: "eth",
      fetchImpl,
      headers: new Headers({ "x-trace-id": "trace-trade-fragments" }),
    });

    expect(result.symbol).toBe("ETH");

    // All 9 fragment ports were hit (canary serviceUrls 4203–4211).
    const ports = calls.map(portOf).sort();
    expect(ports).toEqual([
      "4203",
      "4204",
      "4205",
      "4206",
      "4207",
      "4208",
      "4209",
      "4210",
      "4211",
    ]);

    // Each slot resolved to its fragment's live HTML.
    for (const [port, slotKey] of Object.entries(FRAGMENT_PORTS)) {
      const name = FRAGMENT_NAME_BY_PORT[port];
      expect(result.html[slotKey]).toContain(`${name} live`);
      expect(result.diagnostics[slotKey].status).toBe("ok");
    }

    expect(result.diagnostics.marketHeader).toMatchObject({
      strategy: "cached-ssr",
      required: true,
    });
    expect(result.diagnostics.fundingBar.strategy).toBe("cached-ssr");
    expect(result.diagnostics.book.strategy).toBe("dynamic-ssr");

    // Shared account node is deduped: first read via loader, second observes it.
    expect(result.dataDiagnostics.account).toMatchObject({
      firstRead: "loader",
      secondRead: "pending",
    });

    expect(result.scheduler.health).toBe("ok");
    expect(Array.isArray(result.scheduler.hints)).toBe(true);
    expect(result.traceLog).toContain("data:trade-account");
    expect(result.traceLog).toContain("runtime.fetchFragmentSlots");
    expect(result.traceLog).toContain("slot:marketHeader");
  });

  it("degrades (not breaks) when an optional realtime fragment fails", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      // order-book (4204) fails; everything else succeeds.
      if (portOf(String(url)) === "4204") throw new Error("order-book down");
      return makeFragmentFetch()(url);
    }) as typeof fetch;

    const result = await fetchTradeFragmentSlots({
      symbol: "BTC",
      fetchImpl,
      timeoutMs: 20,
    });

    expect(result.scheduler.health).toBe("degraded");
    expect(result.diagnostics.marketHeader.status).toBe("ok");
    expect(result.diagnostics.book.status).toBe("fallback");
    // The failed optional slot returns a no-JS-readable fallback section
    // (data-fallback="true") — the panel degrades instead of breaking.
    expect(result.html.book).toContain('data-fallback="true"');
  });

  it("reports unhealthy when the required market-header fails", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      if (portOf(String(url)) === "4203") throw new Error("market-header down");
      return makeFragmentFetch()(url);
    }) as typeof fetch;

    const result = await fetchTradeFragmentSlots({
      symbol: "BTC",
      fetchImpl,
      timeoutMs: 20,
    });

    expect(result.scheduler.health).toBe("unhealthy");
    expect(result.diagnostics.marketHeader.status).toBe("fallback");
  });

  it("full page HTML renders fragment content into named grid areas", async () => {
    const result = await fetchTradeFragmentSlots({
      symbol: "SOL",
      fetchImpl: makeFragmentFetch(),
    });
    const html = renderTradeHtml(result.symbol, {
      marketHeader: result.html.marketHeader,
      book: result.html.book,
      trades: result.html.trades,
      orderForm: result.html.orderForm,
      accountBar: result.html.accountBar,
      positions: result.html.positions,
      openOrders: result.html.openOrders,
      fundingBar: result.html.fundingBar,
    });

    expect(html).toContain("market-header live");
    expect(html).toContain("order-book live");
    expect(html).toContain("funding-bar live");
    expect(html).toContain('data-symbol="SOL"');
  });

  it("keeps SSR readable when all fragments fail (fallback path)", () => {
    const html = renderTradeHtml("BTC", {
      marketHeader: null,
      book: null,
      orderForm: null,
      positions: null,
    });
    expect(html).toContain('data-page="trade"');
    expect(html).toContain('data-fallback="true"');
    expect(html).toContain("Order book for BTC is loading.");
  });
});
