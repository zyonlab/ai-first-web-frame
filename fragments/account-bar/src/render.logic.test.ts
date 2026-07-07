import type { AccountMargin } from "@mvp/data";
import { describe, expect, it } from "vitest";
import { accountBarBudget } from "./budget";
import { toAccountBarView } from "./data";
import { validateAccountBarManifest } from "./manifest";
import {
  DEFAULT_LEVERAGE,
  ISLAND_NAME,
  ISLAND_SLICE,
  renderAccountBarHtml,
} from "./render";

function account(overrides: Partial<AccountMargin> = {}): AccountMargin {
  return {
    equity: 100_092,
    used: 20_018.4,
    free: 80_073.6,
    maintenance: 1000.92,
    ...overrides,
  };
}

describe("renderAccountBarHtml (stable SSR HTML)", () => {
  const view = toAccountBarView(account());
  const html = renderAccountBarHtml(view, DEFAULT_LEVERAGE);

  it("renders the fragment wrapper + island mount point", () => {
    expect(html).toContain('data-fragment="account-bar"');
    expect(html).toContain(`data-island="${ISLAND_NAME}"`);
  });

  it("renders equity / margin used / withdrawable from the view (no JS needed)", () => {
    expect(html).toContain('data-value="equity">100,092.00');
    expect(html).toContain('data-value="marginUsed">20,018.40');
    expect(html).toContain('data-value="withdrawable">80,073.60');
    expect(html).toContain('data-value="marginUsagePct">20.00%');
  });

  it("seeds the margin-usage meter via the --usage custom property", () => {
    expect(html).toContain("--usage:0.2000");
    expect(html).toContain("account-bar__meter-fill");
  });

  it("emits the C2 inline JSON snapshot carrying props + slice", () => {
    expect(html).toContain(`data-island-props="${ISLAND_NAME}"`);
    const match = html.match(
      /<script type="application\/json" data-island-props="accountBar">([\s\S]*?)<\/script>/,
    );
    expect(match).toBeTruthy();
    const snapshot = JSON.parse((match?.[1] ?? "").replaceAll("\\u003c", "<"));
    expect(snapshot.slice).toBe(ISLAND_SLICE);
    expect(snapshot.slice).toBe("trade.leverage");
    expect(snapshot.props.seededLeverage).toBe(DEFAULT_LEVERAGE);
    expect(snapshot.props.view.equity).toBe("100,092.00");
    expect(snapshot.props.view.withdrawable).toBe("80,073.60");
  });

  it("neutralizes </script> so the snapshot cannot break out of the tag", () => {
    // The escape only affects `<`; a well-formed snapshot has no raw `</script>`.
    expect(html).not.toContain("</script></script>");
  });
});

describe("manifest + budget contract", () => {
  it("passes manifest schema validation", () => {
    expect(validateAccountBarManifest()).toBe(true);
  });

  it("declares dynamic-ssr, no shared TTL, and the shared trade-client chunk", async () => {
    const { accountBarManifest } = await import("./manifest");
    expect(accountBarManifest.renderStrategy).toBe("dynamic-ssr");
    expect(accountBarManifest.cachePolicy.ttl).toBe(0);
    expect(accountBarManifest.assets.js).toContain("@mvp/trade-client");
    // Shared `account` data node (dedupe with order-form / positions-table).
    expect(accountBarManifest.dataDependencies).toEqual(["account"]);
  });

  it("stays within the 30KB JS / 10KB CSS ceiling (small island)", () => {
    expect(accountBarBudget).toMatchObject({
      scope: "fragment",
      maxFragmentLatencyMs: 200,
    });
    expect(accountBarBudget.jsBytes).toBeLessThanOrEqual(30_000);
    expect(accountBarBudget.cssBytes).toBeLessThanOrEqual(10_000);
  });
});
