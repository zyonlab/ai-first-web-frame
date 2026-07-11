import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  evaluateRuntime,
  type RuntimeObservation,
} from "./checks";

const clean: RuntimeObservation = {
  pageErrors: [],
  consoleErrors: [],
  staticRequests: [
    { url: "/_next/static/chunks/main.js", status: 200 },
    { url: "/assets/order-book.css", status: 200 },
  ],
  panes: [
    { area: "chart", areaHeight: 600, contentHeight: 598 },
    { area: "book", areaHeight: 720, contentHeight: 718 },
  ],
  horizontalOverflowPx: 0,
  interaction: { name: "orderbook-price", ok: true },
};

describe("evaluateRuntime", () => {
  it("passes a clean run", () => {
    const { ok, checks } = evaluateRuntime(clean);
    expect(ok).toBe(true);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "hydration-clean",
        "no-react-418",
        "assets-delivered",
        "layout-fit",
        "no-horizontal-overflow",
        "interaction:orderbook-price",
      ]),
    );
  });

  it("fails on React #418 (hydration mismatch)", () => {
    const { ok, checks } = evaluateRuntime({
      ...clean,
      pageErrors: ["Minified React error #418; visit ..."],
    });
    expect(ok).toBe(false);
    expect(checks.find((c) => c.name === "no-react-418")?.ok).toBe(false);
    expect(checks.find((c) => c.name === "hydration-clean")?.ok).toBe(false);
  });

  it("fails on a static asset 404 (CSS / chunk not delivered)", () => {
    const { checks } = evaluateRuntime({
      ...clean,
      staticRequests: [{ url: "/assets/order-book.css", status: 404 }],
    });
    const c = checks.find((x) => x.name === "assets-delivered");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain("order-book.css");
  });

  it("fails on a large pane void (the 490px header-void class)", () => {
    const { checks } = evaluateRuntime({
      ...clean,
      panes: [{ area: "header", areaHeight: 557, contentHeight: 67 }],
    });
    const c = checks.find((x) => x.name === "layout-fit");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain("header");
  });

  it("fails on horizontal overflow past the threshold", () => {
    const { checks } = evaluateRuntime({ ...clean, horizontalOverflowPx: 40 });
    expect(checks.find((c) => c.name === "no-horizontal-overflow")?.ok).toBe(
      false,
    );
  });

  it("respects custom thresholds", () => {
    const obs = {
      ...clean,
      panes: [{ area: "book", areaHeight: 720, contentHeight: 690 }],
    };
    // void 30 — fails a strict 24px budget, passes the default 48px.
    expect(evaluateRuntime(obs).ok).toBe(true);
    expect(
      evaluateRuntime(obs, { ...DEFAULT_THRESHOLDS, maxPaneVoidPx: 24 }).ok,
    ).toBe(false);
  });

  it("measures layout-fit via [data-fragment] panes on non-trade pages", () => {
    const obs: RuntimeObservation = {
      ...clean,
      panes: [
        { area: "promotion-banner", areaHeight: 96, contentHeight: 94 },
        { area: "recommendation-widget", areaHeight: 240, contentHeight: 236 },
      ],
      paneSource: "data-fragment",
    };
    const { ok, checks } = evaluateRuntime(obs);
    expect(ok).toBe(true);
    const layoutFit = checks.find((c) => c.name === "layout-fit");
    expect(layoutFit?.ok).toBe(true);
    expect(layoutFit?.detail).toContain("data-fragment");
  });

  it("fails a large void measured via the [data-fragment] fallback", () => {
    const { checks } = evaluateRuntime({
      ...clean,
      panes: [
        { area: "recommendation-widget", areaHeight: 400, contentHeight: 40 },
      ],
      paneSource: "data-fragment",
    });
    const layoutFit = checks.find((c) => c.name === "layout-fit");
    expect(layoutFit?.ok).toBe(false);
    expect(layoutFit?.detail).toContain("recommendation-widget");
    expect(layoutFit?.detail).toContain("data-fragment");
  });

  it("reports no panes measured, naming both tried selectors", () => {
    const { checks } = evaluateRuntime({
      ...clean,
      panes: [],
      paneSource: "none",
    });
    const layoutFit = checks.find((c) => c.name === "layout-fit");
    expect(layoutFit?.ok).toBe(true);
    expect(layoutFit?.detail).toContain("[data-area]");
    expect(layoutFit?.detail).toContain("[data-fragment]");
  });

  it("infers data-area as the pane source when paneSource is omitted (back-compat)", () => {
    const { checks } = evaluateRuntime({
      ...clean,
      panes: [{ area: "header", areaHeight: 557, contentHeight: 67 }],
      paneSource: undefined,
    });
    const layoutFit = checks.find((c) => c.name === "layout-fit");
    expect(layoutFit?.detail).toContain("data-area");
  });

  it("reports a skipped interaction check as passing and explicit, not silently absent", () => {
    const { ok, checks } = evaluateRuntime({
      ...clean,
      interaction: {
        name: "orderbook→order-form-price",
        ok: false,
        skipped: true,
        detail: "no order-book on this page — skipped",
      },
    });
    expect(ok).toBe(true);
    const interaction = checks.find((c) => c.name.startsWith("interaction:"));
    expect(interaction?.ok).toBe(true);
    expect(interaction?.skipped).toBe(true);
    expect(interaction?.detail).toContain("skipped");
  });
});
