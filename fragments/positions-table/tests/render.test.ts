import { describe, expect, it } from "vitest";
import {
  createPositionsTableFallback,
  renderPositionRow,
  renderPositionsHtml,
  renderPositionsTable,
} from "../src/render";

describe("positions-table SSR render", () => {
  it("renders a stable positions table from the fixture snapshot", async () => {
    const result = await renderPositionsTable({ ctx: { locale: "en-US" } });
    expect(result.statusCode).toBe(200);
    const html = "html" in result.body ? result.body.html : "";
    expect(html).toContain('data-fragment="positions-table"');
    expect(html).toContain('data-island="positions"');
    // deterministic fixture positions: BTC long (+60), ETH short (+32)
    expect(html).toContain('data-symbol="BTC"');
    expect(html).toContain('data-symbol="ETH"');
    expect(html).toContain('data-direction="long"');
    expect(html).toContain('data-direction="short"');
  });

  it("renders every position column header", async () => {
    const result = await renderPositionsTable({});
    const html = "html" in result.body ? result.body.html : "";
    for (const label of [
      "Symbol",
      "Side",
      "Size",
      "Entry",
      "Mark",
      "Liq.",
      "uPnL",
      "Close",
    ]) {
      expect(html).toContain(`>${label}</th>`);
    }
  });

  it("colors uPnL by sign via up/down semantic classes", () => {
    const long = renderPositionRow({
      symbol: "BTC",
      size: 0.5,
      entryPrice: 62_883.35,
      markPrice: 63_003.35,
      liquidationPrice: 37_802.01,
      unrealizedPnl: 60,
    });
    expect(long).toContain("pt-pnl--up");
    expect(long).toContain('data-sign="up"');
    expect(long).toContain("+60.00");

    const losing = renderPositionRow({
      symbol: "SOL",
      size: -10,
      entryPrice: 140,
      markPrice: 150,
      liquidationPrice: 200,
      unrealizedPnl: -100,
    });
    expect(losing).toContain("pt-pnl--down");
    expect(losing).toContain('data-sign="down"');
    expect(losing).toContain("-100.00");
    // short direction tag + SHORT label
    expect(losing).toContain('data-direction="short"');
    expect(losing).toContain(">SHORT<");
  });

  it("renders entry / mark / liq numeric cells for a row", () => {
    const row = renderPositionRow({
      symbol: "BTC",
      size: 0.5,
      entryPrice: 62_883.35,
      markPrice: 63_003.35,
      liquidationPrice: 37_802.01,
      unrealizedPnl: 60,
    });
    expect(row).toContain('data-field="entry">62,883.35<');
    expect(row).toContain('data-field="mark">63,003.35<');
    expect(row).toContain('data-field="liq">37,802.01<');
    // size rendered as absolute magnitude
    expect(row).toContain('data-field="size">0.5000<');
  });

  it("renders a close-control placeholder button per row", () => {
    const row = renderPositionRow({
      symbol: "BTC",
      size: 0.5,
      entryPrice: 1,
      markPrice: 1,
      liquidationPrice: 1,
      unrealizedPnl: 0,
    });
    expect(row).toContain('class="pt-close"');
    expect(row).toContain('data-action="close"');
    expect(row).toContain('aria-label="Close BTC position"');
  });

  it("emits the island mount node + inline JSON snapshot", async () => {
    const result = await renderPositionsTable({});
    const html = "html" in result.body ? result.body.html : "";
    expect(html).toContain('data-island-props="positions"');
    const match = /data-island-props="positions">([\s\S]*?)<\/script>/.exec(
      html,
    );
    expect(match).toBeTruthy();
    const snapshot = JSON.parse(
      (match?.[1] ?? "{}")
        .replaceAll("\\u003c", "<")
        .replaceAll("\\u003e", ">"),
    );
    expect(Array.isArray(snapshot.positions)).toBe(true);
    expect(snapshot.positions.length).toBeGreaterThan(0);
    expect(snapshot.positions[0].symbol).toBe("BTC");
  });

  it("marks the active symbol row when seeded via props", async () => {
    const result = await renderPositionsTable({
      props: { activeSymbol: "eth" },
    });
    const html = "html" in result.body ? result.body.html : "";
    // ETH row is active, BTC is not
    expect(html).toMatch(
      /data-symbol="ETH"[^>]*data-active="true"|is-active[^>]*data-symbol="ETH"/,
    );
    expect(html).toContain('data-active="true"');
  });

  it("renders an empty-state row when there are no positions", () => {
    const html = renderPositionsHtml([]);
    expect(html).toContain("No open positions");
    expect(html).toContain('class="pt-empty"');
  });

  it("produces a no-js readable fallback section", () => {
    const fallback = createPositionsTableFallback("boom");
    expect(fallback.html).toContain('data-fallback="true"');
    expect(fallback.html).toContain("boom");
    expect(fallback.metadata.name).toBe("positions-table");
  });

  it("escapes untrusted symbol text in a row", () => {
    const row = renderPositionRow({
      symbol: '<script>"x',
      size: 1,
      entryPrice: 1,
      markPrice: 1,
      liquidationPrice: 1,
      unrealizedPnl: 0,
    });
    // symbol keys are uppercased; the angle brackets + quote must be escaped
    expect(row).not.toContain("<script>");
    expect(row).not.toContain("<SCRIPT>");
    expect(row).toContain("&lt;SCRIPT&gt;");
    expect(row).toContain("&quot;");
  });
});
