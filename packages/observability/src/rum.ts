"use client";

/**
 * Real-user monitoring for the browser.
 *
 * Browser-only by nature — it reads `performance` and installs
 * `PerformanceObserver`s — so it is a separate `@mvp/observability/rum` entry
 * carrying `"use client"`, the same shape as `@mvp/runtime/live`. A server
 * bundle never pulls it in, and `audit:deps`' `server-safe-browser-global` rule
 * stays satisfied for the package's main entry.
 *
 * What was here before: one island reported
 * `{ name: "INP", value: performance.now() }` at mount. That is elapsed time
 * since navigation, not Interaction to Next Paint — it never observed an
 * interaction at all. A dashboard fed by it would have shown a confident,
 * precise, wrong number, which is worse than an empty panel.
 *
 * ## The correlation trick
 *
 * `readTraceparent()` pulls the server's `traceparent` out of the navigation
 * entry's `serverTiming`, because the gateway publishes it there. That is what
 * lets a client-side LCP sample and a server-side span tree carry the same
 * trace id — without it the two are separate stories about the same page load.
 */

export type RumMetricName = "LCP" | "INP" | "CLS" | "TTFB";

export type RumMetric = {
  name: RumMetricName;
  value: number;
  /** Where the value came from, for a reader deciding whether to trust it. */
  source: "navigation" | "observer";
};

export type RumLongTask = {
  /** Milliseconds the main thread was blocked. */
  durationMs: number;
  startTimeMs: number;
  attribution: string;
};

type Nav = PerformanceNavigationTiming | undefined;

function navigationEntry(): Nav {
  return typeof performance === "undefined"
    ? undefined
    : (performance.getEntriesByType("navigation")[0] as Nav);
}

/**
 * Per-slot server timings the gateway published on this navigation.
 *
 * This is the server half of a page-load story arriving through a standard
 * browser API rather than through a bespoke payload — the same entries Chrome
 * shows in its network panel.
 */
export function readServerTiming(): {
  name: string;
  durationMs: number;
  description: string;
}[] {
  const entries = navigationEntry()?.serverTiming ?? [];
  return Array.from(entries, (entry) => ({
    name: entry.name,
    durationMs: entry.duration,
    description: entry.description,
  }));
}

/** The server's `traceparent`, published as a `Server-Timing` entry. */
export function readTraceparent(): string | undefined {
  return readServerTiming().find((entry) => entry.name === "traceparent")
    ?.description;
}

function observe(
  type: string,
  callback: (entries: PerformanceEntryList) => void,
  options: PerformanceObserverInit = {},
): (() => void) | undefined {
  if (typeof PerformanceObserver === "undefined") return undefined;
  // A browser that does not implement an entry type throws on observe(); an
  // unsupported metric must degrade to "not reported", never to a wrong value.
  try {
    const observer = new PerformanceObserver((list) =>
      callback(list.getEntries()),
    );
    observer.observe({ type, buffered: true, ...options });
    return () => observer.disconnect();
  } catch {
    return undefined;
  }
}

/**
 * Observes the four web vitals and calls `onMetric` as each becomes known.
 *
 * LCP and CLS are only final once the page is backgrounded or unloaded, so both
 * are reported on `visibilitychange`. INP is reported per interaction as the
 * running worst case, which is what the metric is defined as.
 */
export function observeWebVitals(
  onMetric: (metric: RumMetric) => void,
): () => void {
  const stops: Array<(() => void) | undefined> = [];

  const nav = navigationEntry();
  if (nav && nav.responseStart > 0) {
    onMetric({ name: "TTFB", value: nav.responseStart, source: "navigation" });
  }

  let lcp = 0;
  stops.push(
    observe("largest-contentful-paint", (entries) => {
      const last = entries[entries.length - 1];
      if (last) lcp = last.startTime;
    }),
  );

  let cls = 0;
  stops.push(
    observe("layout-shift", (entries) => {
      for (const entry of entries as unknown as {
        value: number;
        hadRecentInput: boolean;
      }[]) {
        // Shifts within 500ms of an input are the user's doing, not the page's.
        if (!entry.hadRecentInput) cls += entry.value;
      }
    }),
  );

  let inp = 0;
  stops.push(
    observe(
      "event",
      (entries) => {
        for (const entry of entries as unknown as {
          duration: number;
          interactionId?: number;
        }[]) {
          // Only entries with an interactionId are real interactions; the rest
          // are event timings that INP deliberately excludes.
          if (!entry.interactionId) continue;
          if (entry.duration > inp) {
            inp = entry.duration;
            onMetric({ name: "INP", value: inp, source: "observer" });
          }
        }
      },
      { durationThreshold: 40 } as PerformanceObserverInit,
    ),
  );

  const flush = () => {
    if (document.visibilityState !== "hidden") return;
    if (lcp > 0) onMetric({ name: "LCP", value: lcp, source: "observer" });
    onMetric({ name: "CLS", value: cls, source: "observer" });
  };
  document.addEventListener("visibilitychange", flush);

  return () => {
    document.removeEventListener("visibilitychange", flush);
    for (const stop of stops) stop?.();
  };
}

/**
 * Observes long tasks — the main-thread blocks behind "the page feels janky".
 *
 * Not a web vital, and deliberately separate: a vital tells you the page was
 * slow, a long task tells you which script to look at.
 */
export function observeLongTasks(
  onTask: (task: RumLongTask) => void,
): () => void {
  const stop = observe("longtask", (entries) => {
    for (const entry of entries) {
      onTask({
        durationMs: entry.duration,
        startTimeMs: entry.startTime,
        attribution:
          (
            entry as unknown as {
              attribution?: { name?: string }[];
            }
          ).attribution?.[0]?.name ?? "unknown",
      });
    }
  });
  return () => stop?.();
}

export type RumReport = {
  name: RumMetricName;
  value: number;
  route: string;
  source: RumMetric["source"];
  traceparent?: string;
};

/**
 * Builds a beacon reporter.
 *
 * `sendBeacon` when available so a metric flushed during unload is not dropped;
 * a keepalive `fetch` otherwise. Failures are swallowed on purpose — telemetry
 * that breaks the page it measures is worse than missing telemetry.
 */
export function createRumReporter(options: {
  endpoint: string;
  route?: string;
}): (metric: RumMetric) => void {
  const traceparent = readTraceparent();
  const route =
    options.route ??
    (typeof location === "undefined" ? "/" : location.pathname);

  return (metric) => {
    const report: RumReport = {
      name: metric.name,
      value: Math.round(metric.value * 1000) / 1000,
      route,
      source: metric.source,
      ...(traceparent ? { traceparent } : {}),
    };
    const body = JSON.stringify(report);
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          options.endpoint,
          new Blob([body], { type: "application/json" }),
        );
        return;
      }
      void fetch(options.endpoint, {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* telemetry must never break the page it measures */
    }
  };
}
