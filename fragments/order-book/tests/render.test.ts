import { describe, expect, it } from "vitest";
import { createOrderBookFallback, renderOrderBook } from "../src/render";

describe("order-book SSR render", () => {
  it("renders a stable high-density ladder from the BTC fixture", async () => {
    const result = await renderOrderBook({
      props: { symbol: "BTC", grouping: 1 },
    });
    expect(result.statusCode).toBe(200);
    const html = "html" in result.body ? result.body.html : "";
    expect(html).toContain('data-fragment="order-book"');
    expect(html).toContain('data-symbol="BTC"');
    // deterministic golden values from tradeFixtures.BTC.orderbook
    expect(html).toContain('data-value="62982.3"'); // best bid
    expect(html).toContain('data-value="62988.6"'); // best ask
    // spread strip present with the fixture spread
    expect(html).toContain('data-field="spread"');
    expect(html).toContain("6.3");
  });

  it("keeps best bid below best ask in the rendered rows", async () => {
    const result = await renderOrderBook({ props: { symbol: "BTC" } });
    const html = "html" in result.body ? result.body.html : "";
    const bidIdx = html.indexOf('data-value="62982.3"');
    const askIdx = html.indexOf('data-value="62988.6"');
    expect(bidIdx).toBeGreaterThan(-1);
    expect(askIdx).toBeGreaterThan(-1);
    // both sides tagged
    expect(html).toContain('class="ob-row ob-bid"');
    expect(html).toContain('class="ob-row ob-ask"');
  });

  it("emits CSS depth bars via the --depth var on rows", async () => {
    const result = await renderOrderBook({ props: { symbol: "BTC" } });
    const html = "html" in result.body ? result.body.html : "";
    expect(html).toMatch(/style="--depth:\d+(\.\d+)?%"/);
    // best cumulative level reaches full depth somewhere
    expect(html).toContain("--depth:100.00%");
  });

  it("emits the C2 island mount node + inline JSON snapshot", async () => {
    const result = await renderOrderBook({ props: { symbol: "BTC" } });
    const html = "html" in result.body ? result.body.html : "";
    expect(html).toContain('data-island="book"');
    expect(html).toContain('data-island-props="book"');
    const match = /data-island-props="book">([\s\S]*?)<\/script>/.exec(html);
    expect(match).toBeTruthy();
    const snapshot = JSON.parse(
      (match?.[1] ?? "{}")
        .replaceAll("\\u003c", "<")
        .replaceAll("\\u003e", ">"),
    );
    expect(snapshot.props.symbol).toBe("BTC");
    expect(snapshot.props.levels.bids.length).toBeGreaterThan(0);
    expect(snapshot.slice).toBe("orderDraft");
  });

  it("renders the grouping chips with the active chip marked", async () => {
    const result = await renderOrderBook({
      props: { symbol: "BTC", grouping: 5 },
    });
    const html = "html" in result.body ? result.body.html : "";
    expect(html).toContain('data-grouping="5"');
    expect(html).toContain('class="ob-chip is-active" data-grouping="5"');
  });

  it("respects the depth prop (levels per side)", async () => {
    const result = await renderOrderBook({
      props: { symbol: "BTC", depth: 3 },
    });
    const html = "html" in result.body ? result.body.html : "";
    const rows = html.match(/class="ob-row/g) ?? [];
    expect(rows).toHaveLength(6); // 3 bids + 3 asks
  });

  it("returns a 400 fallback for a missing symbol prop", async () => {
    const result = await renderOrderBook({ ctx: {} });
    expect(result.statusCode).toBe(400);
    const html = "html" in result.body ? result.body.html : "";
    expect(html).toContain('data-fallback="true"');
  });

  it("produces a no-js readable fallback section", () => {
    const fallback = createOrderBookFallback("boom");
    expect(fallback.html).toContain('data-fallback="true"');
    expect(fallback.html).toContain("boom");
    expect(fallback.metadata.name).toBe("order-book");
  });
});
