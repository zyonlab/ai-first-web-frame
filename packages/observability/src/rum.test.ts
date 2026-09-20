/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRumReporter,
  observeLongTasks,
  observeWebVitals,
  readServerTiming,
  readTraceparent,
} from "./rum";

/**
 * The bug this module replaced reported `performance.now()` at mount under the
 * name "INP" — a precise, confident, wrong number. So these tests care most
 * about two things: that a metric is only emitted when it was actually
 * observed, and that an unsupported browser degrades to silence rather than to
 * a plausible-looking value.
 */

function stubNavigation(serverTiming: unknown[], responseStart = 0) {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([
    { responseStart, serverTiming },
  ] as unknown as PerformanceEntryList);
}

afterEach(() => vi.restoreAllMocks());

describe("readServerTiming", () => {
  it("reads the entries the gateway published on this navigation", () => {
    stubNavigation([
      { name: "book", duration: 142, description: "network" },
      { name: "promotion", duration: 0, description: "cache" },
    ]);
    expect(readServerTiming()).toEqual([
      { name: "book", durationMs: 142, description: "network" },
      { name: "promotion", durationMs: 0, description: "cache" },
    ]);
  });

  it("returns nothing when the navigation carries no timings", () => {
    stubNavigation([]);
    expect(readServerTiming()).toEqual([]);
  });
});

describe("readTraceparent", () => {
  const tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

  it("picks the server's trace id out of Server-Timing", () => {
    stubNavigation([
      { name: "traceparent", duration: 0, description: tp },
      { name: "shell", duration: 12, description: "gateway total" },
    ]);
    expect(readTraceparent()).toBe(tp);
  });

  it("is undefined when the server did not publish one", () => {
    stubNavigation([{ name: "shell", duration: 12, description: "" }]);
    expect(readTraceparent()).toBeUndefined();
  });
});

describe("observeWebVitals", () => {
  it("reports TTFB from the navigation entry", () => {
    stubNavigation([], 87.5);
    const seen: unknown[] = [];
    const stop = observeWebVitals((m) => seen.push(m));
    expect(seen).toContainEqual({
      name: "TTFB",
      value: 87.5,
      source: "navigation",
    });
    stop();
  });

  it("does not report TTFB when the navigation has no responseStart", () => {
    // A value of 0 means "not measured", not "instant". Reporting it would put
    // a 0ms bar in a dashboard for every browser that withheld the timing.
    stubNavigation([], 0);
    const seen: unknown[] = [];
    const stop = observeWebVitals((m) => seen.push(m));
    expect(seen).toEqual([]);
    stop();
  });

  it("returns a working teardown when PerformanceObserver is absent", () => {
    stubNavigation([], 10);
    const original = globalThis.PerformanceObserver;
    // @ts-expect-error — simulating a browser without the API
    globalThis.PerformanceObserver = undefined;
    const stop = observeWebVitals(() => {});
    expect(() => stop()).not.toThrow();
    globalThis.PerformanceObserver = original;
  });
});

describe("observeLongTasks", () => {
  it("degrades to a no-op teardown where longtask is unsupported", () => {
    const original = globalThis.PerformanceObserver;
    // @ts-expect-error — simulating a browser without the API
    globalThis.PerformanceObserver = undefined;
    expect(() => observeLongTasks(() => {})()).not.toThrow();
    globalThis.PerformanceObserver = original;
  });
});

describe("createRumReporter", () => {
  const tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

  it("tags every sample with the server's trace id", async () => {
    stubNavigation([{ name: "traceparent", duration: 0, description: tp }]);
    const sent: string[] = [];
    vi.stubGlobal("navigator", {
      sendBeacon: (_url: string, blob: Blob) => {
        void blob.text().then((t) => sent.push(t));
        return true;
      },
    });
    const report = createRumReporter({ endpoint: "/api/rum", route: "/" });
    report({ name: "LCP", value: 1234.5678, source: "observer" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(sent[0] as string)).toEqual({
      name: "LCP",
      value: 1234.568,
      route: "/",
      source: "observer",
      traceparent: tp,
    });
    vi.unstubAllGlobals();
  });

  it("never throws out of the page it measures", () => {
    stubNavigation([]);
    vi.stubGlobal("navigator", {
      sendBeacon: () => {
        throw new Error("beacon blocked");
      },
    });
    const report = createRumReporter({ endpoint: "/api/rum", route: "/" });
    expect(() =>
      report({ name: "CLS", value: 0.02, source: "observer" }),
    ).not.toThrow();
    vi.unstubAllGlobals();
  });
});
