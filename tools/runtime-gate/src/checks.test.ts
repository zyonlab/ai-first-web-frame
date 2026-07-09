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
});
