import { describe, expect, it } from "vitest";
import { type OpenOrder, toOpenOrder } from "../src/patch";
import {
  createOpenOrdersFallback,
  renderOpenOrders,
  renderOrderRow,
  renderOrdersHtml,
} from "../src/render";

function order(over: Partial<OpenOrder> = {}): OpenOrder {
  return toOpenOrder({
    orderId: "ord-1",
    symbol: "BTC",
    side: "buy",
    type: "limit",
    price: 63_000,
    size: 0.25,
    filled: 0,
    ...over,
  });
}

describe("open-orders render — pure HTML", () => {
  it("renders a server-safe table row keyed by orderId with a cancel control", () => {
    const html = renderOrderRow(order());
    expect(html).toContain('data-order-id="ord-1"');
    expect(html).toContain('data-symbol="BTC"');
    expect(html).toContain("oo-row--buy");
    expect(html).toContain("oo-cell--symbol");
    expect(html).toContain("oo-cell--side");
    expect(html).toContain("oo-cell--type");
    expect(html).toContain("oo-cell--price");
    expect(html).toContain("oo-cell--size");
    expect(html).toContain("oo-cell--filled");
    // Cancel control placeholder: a real, keyed button the island binds.
    expect(html).toContain("data-oo-cancel");
    expect(html).toContain('aria-label="Cancel order ord-1"');
  });

  it("emits the section wrapper, thead, island mount + inline snapshot", () => {
    const html = renderOrdersHtml("BTC", [order()]);
    expect(html).toContain('data-fragment="open-orders"');
    expect(html).toContain('data-island="openOrders"');
    expect(html).toContain('data-symbol="BTC"');
    expect(html).toContain("<thead>");
    expect(html).toContain('data-island-props="openOrders"');
    // Patch-only: no React shipped inline.
    expect(html).not.toContain("hydrate");
    // The inline snapshot carries the order for first interactivity.
    expect(html).toContain('"orderId":"ord-1"');
  });

  it("renders a no-JS-readable empty state when there are no orders", () => {
    const html = renderOrdersHtml("BTC", []);
    expect(html).toContain("data-oo-empty");
    expect(html).toContain("No open orders");
  });

  it("is deterministic: same orders yield byte-identical HTML", () => {
    const a = renderOrdersHtml("BTC", [order(), order({ orderId: "ord-2" })]);
    const b = renderOrdersHtml("BTC", [order(), order({ orderId: "ord-2" })]);
    expect(a).toBe(b);
  });

  it("neutralizes an untrusted order id so it cannot break out of the snapshot", () => {
    const html = renderOrdersHtml("BTC", [
      order({ orderId: "</script><script>x" }),
    ]);
    // The malicious closing tag is escaped in both the row attribute and the
    // inline JSON snapshot — no raw injected <script> survives.
    expect(html).not.toContain("<script>x");
    expect(html).toContain("\\u003c");
  });
});

describe("open-orders render — from the fixture data plane", () => {
  it("renders the fixture working order for BTC (server-safe, deterministic)", async () => {
    const result = await renderOpenOrders({
      ctx: { locale: "en-US" },
      props: { symbol: "BTC" },
    });
    expect(result.statusCode).toBe(200);
    if ("html" in result.body) {
      const { html } = result.body;
      expect(html).toContain('data-fragment="open-orders"');
      // The A0 fixture seeds a single BTC limit buy (ord-1).
      expect(html).toContain('data-order-id="ord-1"');
      expect(html).toContain("oo-row--buy");
      expect(html).toContain("data-oo-cancel");
    }
    expect(result.body.cache?.ttl).toBe(0);
    expect(result.body.cache?.tags).toContain("orders");
  });

  it("scopes the table to the active symbol (ETH has no fixture orders)", async () => {
    const result = await renderOpenOrders({ props: { symbol: "ETH" } });
    expect(result.statusCode).toBe(200);
    if ("html" in result.body) {
      expect(result.body.html).toContain("No open orders");
      expect(result.body.html).not.toContain('data-order-id="ord-1"');
    }
  });

  it("is deterministic across renders", async () => {
    const a = await renderOpenOrders({ props: { symbol: "BTC" } });
    const b = await renderOpenOrders({ props: { symbol: "BTC" } });
    if ("html" in a.body && "html" in b.body) {
      expect(a.body.html).toBe(b.body.html);
    }
  });

  it("returns a 400 fallback for missing props", async () => {
    const result = await renderOpenOrders({ ctx: {} });
    expect(result.statusCode).toBe(400);
    expect(result.body.html).toContain("data-fallback");
  });
});

describe("open-orders render — fallback", () => {
  it("builds a no-js-readable fallback section", () => {
    const fallback = createOpenOrdersFallback("boom");
    expect(fallback.html).toContain('data-fallback="true"');
    expect(fallback.html).toContain("boom");
    expect(fallback.assets).toEqual({ js: [], css: [] });
  });
});
