import { describe, expect, it } from "vitest";
import type { PortfolioSnapshot } from "../src/data";
import {
  createPortfolioSummaryFallback,
  renderPortfolioSummary,
  renderPortfolioSummaryHtml,
} from "../src/render";

function snapshot(
  overrides: Partial<PortfolioSnapshot> = {},
): PortfolioSnapshot {
  return {
    account: {
      equity: 100_000,
      used: 20_000,
      free: 80_000,
      maintenance: 1_000,
    },
    balances: {
      equity: 100_240,
      withdrawable: 80_000,
      unrealizedPnl: 240,
    },
    positions: [
      {
        symbol: "BTC",
        size: 0.5,
        entryPrice: 62_880,
        markPrice: 63_000,
        liquidationPrice: 37_800,
        unrealizedPnl: 60,
      },
      {
        symbol: "ETH",
        size: -4,
        entryPrice: 3_108,
        markPrice: 3_100,
        liquidationPrice: 4_340,
        unrealizedPnl: -32,
      },
    ],
    ...overrides,
  };
}

describe("renderPortfolioSummaryHtml (pure, deterministic)", () => {
  it("renders the four overview cards with equity/uPnL/margin/withdrawable", () => {
    const html = renderPortfolioSummaryHtml(snapshot());
    expect(html).toContain('data-fragment="portfolio-summary"');
    expect(html).toContain("Equity");
    expect(html).toContain("100,240.00");
    expect(html).toContain("Unrealized PnL");
    expect(html).toContain("+240.00");
    expect(html).toContain("Margin Usage");
    expect(html).toContain("20.00%");
    expect(html).toContain("Withdrawable");
    expect(html).toContain("80,000.00");
  });

  it("colors the unrealized PnL card by sign (up)", () => {
    const html = renderPortfolioSummaryHtml(snapshot());
    expect(html).toContain("ps-value--up");
    expect(html).toContain('data-sign="up"');
  });

  it("colors a losing unrealized PnL card as down", () => {
    const html = renderPortfolioSummaryHtml(
      snapshot({
        balances: {
          equity: 99_500,
          withdrawable: 80_000,
          unrealizedPnl: -500,
        },
      }),
    );
    expect(html).toContain("ps-value--down");
    expect(html).toContain("-500.00");
  });

  it("drives the margin-usage meter from the --usage var", () => {
    const html = renderPortfolioSummaryHtml(snapshot());
    expect(html).toContain("--usage:0.2000");
    expect(html).toContain('role="meter"');
  });

  it("renders a positions row per position with symbol deep links", () => {
    const html = renderPortfolioSummaryHtml(snapshot());
    // BTC long row, deep-linked to /trade/BTC
    expect(html).toContain('href="/trade/BTC"');
    expect(html).toContain('data-symbol="BTC"');
    expect(html).toContain(">LONG<");
    expect(html).toContain("0.5000");
    expect(html).toContain("63,000.00");
    // ETH short row, deep-linked to /trade/ETH
    expect(html).toContain('href="/trade/ETH"');
    expect(html).toContain(">SHORT<");
  });

  it("colors position uPnL cells by sign", () => {
    const html = renderPortfolioSummaryHtml(snapshot());
    expect(html).toContain("ps-pnl--up");
    expect(html).toContain("ps-pnl--down");
    expect(html).toContain("+60.00");
    expect(html).toContain("-32.00");
  });

  it("renders an empty-state row when there are no positions", () => {
    const html = renderPortfolioSummaryHtml(snapshot({ positions: [] }));
    expect(html).toContain("No open positions");
  });

  it("is no-JS readable: plain HTML with no <script> tag", () => {
    const html = renderPortfolioSummaryHtml(snapshot());
    expect(html).not.toContain("<script");
    // Table + links are readable without any client JS.
    expect(html).toContain("<table");
    expect(html).toContain('<a class="ps-link"');
  });

  it("is stable across identical inputs (no non-determinism)", () => {
    expect(renderPortfolioSummaryHtml(snapshot())).toBe(
      renderPortfolioSummaryHtml(snapshot()),
    );
  });
});

describe("createPortfolioSummaryFallback", () => {
  it("returns a no-JS-readable degraded section", () => {
    const fb = createPortfolioSummaryFallback("boom");
    expect(fb.html).toContain('data-fallback="true"');
    expect(fb.html).toContain("boom");
    expect(fb.assets).toEqual({ js: [], css: [] });
  });
});

describe("renderPortfolioSummary (SSR entry, reads through C4 client)", () => {
  it("renders live portfolio data read via createTradeDataClient (C4/C5)", async () => {
    const result = await renderPortfolioSummary({ ctx: { locale: "en-US" } });
    expect(result.statusCode).toBe(200);
    if (!("html" in result.body)) throw new Error("expected html body");
    const { html } = result.body;
    expect(html).toContain('data-fragment="portfolio-summary"');
    // overview cards present
    expect(html).toContain("Equity");
    expect(html).toContain("Margin Usage");
    // positions from the frozen fixtures deep-link to /trade/<SYMBOL>
    expect(html).toMatch(/href="\/trade\/[A-Z0-9]+"/);
  });

  it("attaches the request-time cache policy (ttl 0, user-private tags)", async () => {
    const result = await renderPortfolioSummary({ ctx: { locale: "en-US" } });
    if (!("cache" in result.body)) throw new Error("expected cache body");
    expect(result.body.cache.ttl).toBe(0);
    expect(result.body.cache.tags).toContain("account");
    expect(result.body.cache.tags).toContain("positions");
    expect(result.body.cache.tags).toContain("balances");
  });

  it("records a render span + data spans when a trace is provided", async () => {
    const spans: string[] = [];
    const traceStub = {
      startSpan: (name: string) => {
        spans.push(name);
        return name;
      },
      endSpan: () => {},
    };
    await renderPortfolioSummary(
      { ctx: { locale: "en-US" } },
      // biome-ignore lint/suspicious/noExplicitAny: minimal trace port stub for the test.
      { trace: traceStub as any },
    );
    expect(spans).toContain("render:portfolio-summary");
    expect(spans).toContain("data:account");
    expect(spans).toContain("data:positions");
    expect(spans).toContain("data:balances");
  });
});
