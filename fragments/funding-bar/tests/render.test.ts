import { describe, expect, it } from "vitest";
import type { FundingSnapshot } from "../src/data";
import {
  createFundingBarFallback,
  renderFundingBar,
  renderFundingBarHtml,
} from "../src/render";

const NOW = 1_700_000_000_000;

function snapshot(overrides: Partial<FundingSnapshot> = {}): FundingSnapshot {
  return {
    symbol: "BTC",
    rate: 0.0001,
    nextFundingTs: NOW + (2 * 3600 + 3 * 60 + 4) * 1000,
    intervalMs: 8 * 3_600_000,
    oraclePrice: 65_432.1,
    ts: NOW,
    ...overrides,
  };
}

describe("renderFundingBarHtml (pure, deterministic given now)", () => {
  it("renders a stable funding bar with rate, countdown and oracle", () => {
    const html = renderFundingBarHtml(snapshot(), NOW);
    expect(html).toContain('data-fragment="funding-bar"');
    expect(html).toContain('data-symbol="BTC"');
    // funding rate label
    expect(html).toContain("+0.0100%");
    // countdown seeded from the given now
    expect(html).toContain("02:03:04");
    // oracle price
    expect(html).toContain("data-oracle=");
    expect(html).toContain("65,432.10");
  });

  it("marks a positive rate as up (semantic color hook)", () => {
    const html = renderFundingBarHtml(snapshot({ rate: 0.0002 }), NOW);
    expect(html).toContain("funding-bar__rate--up");
    expect(html).toContain('data-rate-direction="up"');
  });

  it("marks a negative rate as down", () => {
    const html = renderFundingBarHtml(snapshot({ rate: -0.0003 }), NOW);
    expect(html).toContain("funding-bar__rate--down");
    expect(html).toContain('data-rate-direction="down"');
    expect(html).toContain("-0.0300%");
  });

  it("marks a zero rate as flat", () => {
    const html = renderFundingBarHtml(snapshot({ rate: 0 }), NOW);
    expect(html).toContain("funding-bar__rate--flat");
  });

  it("emits a <time> countdown carrying data-next-funding-ts for the vanilla tick", () => {
    const snap = snapshot();
    const html = renderFundingBarHtml(snap, NOW);
    expect(html).toContain(`data-next-funding-ts="${snap.nextFundingTs}"`);
    expect(html).toContain(
      `datetime="${new Date(snap.nextFundingTs).toISOString()}"`,
    );
  });

  it("clamps the countdown to 00:00:00 once funding is due", () => {
    const html = renderFundingBarHtml(snapshot(), NOW + 10 * 3_600_000);
    expect(html).toContain("00:00:00");
  });

  it("is stable across identical inputs (no non-determinism)", () => {
    expect(renderFundingBarHtml(snapshot(), NOW)).toBe(
      renderFundingBarHtml(snapshot(), NOW),
    );
  });
});

describe("createFundingBarFallback", () => {
  it("returns a no-JS-readable degraded section", () => {
    const fb = createFundingBarFallback("boom");
    expect(fb.html).toContain('data-fallback="true"');
    expect(fb.html).toContain("boom");
    expect(fb.assets).toEqual({ js: [], css: [] });
  });
});

describe("renderFundingBar (SSR entry, reads through C4 client)", () => {
  it("returns a 400 fallback when symbol is missing", async () => {
    const result = await renderFundingBar({ props: {} });
    expect(result.statusCode).toBe(400);
    expect(result.body.html).toContain('data-fallback="true"');
  });

  it("renders live funding data read via createTradeDataClient (C4/C5)", async () => {
    const result = await renderFundingBar({
      ctx: { locale: "en-US" },
      props: { symbol: "BTC", now: NOW },
    });
    expect(result.statusCode).toBe(200);
    if (!("html" in result.body)) throw new Error("expected html body");
    const { html } = result.body;
    expect(html).toContain('data-fragment="funding-bar"');
    expect(html).toContain('data-symbol="BTC"');
    // funding rate cell present with a signed percentage
    expect(html).toMatch(/[+-]?\d+\.\d{4}%/);
    // oracle price cell populated from the ticker source
    expect(html).toContain("data-oracle=");
    // countdown seeded deterministically from the injected now
    expect(html).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("attaches the funding cache policy (30s short TTL)", async () => {
    const result = await renderFundingBar({
      props: { symbol: "ETH", now: NOW },
    });
    if (!("cache" in result.body)) throw new Error("expected cache body");
    expect(result.body.cache.ttl).toBe(30);
    expect(result.body.cache.tags).toContain("funding");
    expect(result.body.cache.tags).toContain("funding:ETH");
  });
});
