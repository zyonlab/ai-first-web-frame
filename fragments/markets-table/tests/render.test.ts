import { describe, expect, it } from "vitest";
import type { MarketsTableSnapshot } from "../src/data";
import {
  applyView,
  createMarketsTableFallback,
  renderMarketsTable,
  renderMarketsTableHtml,
} from "../src/render";

function snapshot(): MarketsTableSnapshot {
  return {
    ts: 1_700_000_000_000,
    rows: [
      {
        symbol: "BTC",
        mark: 64_117.5,
        last: 64_117.5,
        change24h: 786.2,
        changePct24h: 0.0124,
        funding: 0.000101,
        volume24h: 1_200_000_000,
      },
      {
        symbol: "ETH",
        mark: 3_398.7,
        last: 3_398.7,
        change24h: -19.8,
        changePct24h: -0.0058,
        funding: -0.000044,
        volume24h: 640_000_000,
      },
    ],
  };
}

describe("renderMarketsTableHtml (pure, deterministic)", () => {
  it("renders a stable table with a header and one row per market", () => {
    const html = renderMarketsTableHtml(snapshot());
    // self-contained scoped stylesheet is inlined once at the front
    expect(html).toContain('<style data-fragment-style="markets-table">');
    expect(
      html.split('<style data-fragment-style="markets-table">'),
    ).toHaveLength(2);
    expect(html).toContain(".markets-table");
    expect(html).toContain('data-fragment="markets-table"');
    expect(html).toContain('data-row-count="2"');
    expect(html).toContain("<table");
    expect(html).toContain(">Symbol<");
    expect(html).toContain(">Volume(24h)<");
    expect(html).toContain('data-symbol="BTC"');
    expect(html).toContain('data-symbol="ETH"');
  });

  it("makes every row a deep link to /trade/<SYMBOL>", () => {
    const html = renderMarketsTableHtml(snapshot());
    expect(html).toContain('href="/trade/BTC"');
    expect(html).toContain('href="/trade/ETH"');
    expect(html).toContain('data-trade-link="BTC"');
  });

  it("colors 24h change up/down by sign", () => {
    const html = renderMarketsTableHtml(snapshot());
    expect(html).toContain("markets-table__change--up");
    expect(html).toContain('data-change-direction="up"');
    expect(html).toContain("markets-table__change--down");
    expect(html).toContain('data-change-direction="down"');
    expect(html).toContain("+1.24%");
    expect(html).toContain("-0.58%");
  });

  it("renders funding and compacted volume cells", () => {
    const html = renderMarketsTableHtml(snapshot());
    expect(html).toContain("+0.0101%");
    expect(html).toContain("-0.0044%");
    expect(html).toContain("1.20B");
    expect(html).toContain("640.00M");
  });

  it("is stable across identical inputs (no non-determinism)", () => {
    expect(renderMarketsTableHtml(snapshot())).toBe(
      renderMarketsTableHtml(snapshot()),
    );
  });
});

describe("applyView (filter + sort parity)", () => {
  it("filters rows by symbol substring (case-insensitive)", () => {
    const view = applyView(snapshot(), { filter: "eth" });
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].symbol).toBe("ETH");
  });

  it("sorts by 24h change descending", () => {
    const view = applyView(snapshot(), { sort: "changePct24h" });
    expect(view.rows.map((r) => r.symbol)).toEqual(["BTC", "ETH"]);
  });

  it("sorts by symbol alphabetically", () => {
    const view = applyView(snapshot(), { sort: "symbol" });
    expect(view.rows.map((r) => r.symbol)).toEqual(["BTC", "ETH"]);
  });
});

describe("createMarketsTableFallback", () => {
  it("returns a no-JS-readable degraded section", () => {
    const fb = createMarketsTableFallback("boom");
    expect(fb.html).toContain('data-fallback="true"');
    expect(fb.html).toContain("boom");
    expect(fb.assets).toEqual({ js: [], css: [] });
  });
});

describe("renderMarketsTable (SSR entry, reads through C4 client)", () => {
  it("renders live markets data read via createTradeDataClient (C4/C5)", async () => {
    const result = await renderMarketsTable({ ctx: { locale: "en-US" } });
    expect(result.statusCode).toBe(200);
    if (!("html" in result.body)) throw new Error("expected html body");
    const { html } = result.body;
    expect(html).toContain('data-fragment="markets-table"');
    // rows deep-link to the trade page
    expect(html).toContain('href="/trade/BTC"');
    expect(html).toContain('href="/trade/ETH"');
    // at least one signed percentage 24h cell
    expect(html).toMatch(/[+-]?\d+\.\d{2}%/);
    // a funding cell to 4 decimals
    expect(html).toMatch(/[+-]?\d+\.\d{4}%/);
  });

  it("attaches the markets cache policy (5s short TTL)", async () => {
    const result = await renderMarketsTable({ props: { sort: "symbol" } });
    if (!("cache" in result.body)) throw new Error("expected cache body");
    expect(result.body.cache.ttl).toBe(5);
    expect(result.body.cache.tags).toContain("markets");
  });
});
