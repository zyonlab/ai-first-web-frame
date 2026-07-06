import { describe, expect, it } from "vitest";
import {
  createHttpMetrics,
  createMetricsRegistry,
  recordWebVital,
} from "./index";

describe("createMetricsRegistry", () => {
  it("counts with labels and rejects negative increments", () => {
    const registry = createMetricsRegistry();
    const counter = registry.createCounter("jobs_total", {
      help: "Total jobs.",
    });
    counter.inc();
    counter.inc(2, { queue: "email" });
    counter.inc(3, { queue: "email" });

    const snapshot = registry.toJSON();
    expect(snapshot.metrics).toEqual([
      {
        name: "jobs_total",
        type: "counter",
        help: "Total jobs.",
        values: [
          { labels: {}, value: 1 },
          { labels: { queue: "email" }, value: 5 },
        ],
      },
    ]);
    expect(() => counter.inc(-1)).toThrow(/cannot decrease/);
    expect(() => counter.inc(Number.NaN)).toThrow(/non-finite/);
  });

  it("sets, increments, and decrements gauges", () => {
    const registry = createMetricsRegistry();
    const gauge = registry.createGauge("active_requests");
    gauge.set(5, { route: "/home" });
    gauge.inc(2, { route: "/home" });
    gauge.dec(4, { route: "/home" });
    gauge.dec();

    const [metric] = registry.toJSON().metrics;
    expect(metric.type).toBe("gauge");
    if (metric.type !== "gauge") throw new Error("expected gauge");
    expect(metric.values).toEqual([
      { labels: { route: "/home" }, value: 3 },
      { labels: {}, value: -1 },
    ]);
  });

  it("tracks cumulative histogram buckets, sum, and count", () => {
    const registry = createMetricsRegistry();
    const histogram = registry.createHistogram("render_ms", {
      buckets: [10, 50, 100],
    });
    histogram.observe(5);
    histogram.observe(50);
    histogram.observe(300);

    const [metric] = registry.toJSON().metrics;
    if (metric.type !== "histogram") throw new Error("expected histogram");
    expect(metric.buckets).toEqual([10, 50, 100]);
    expect(metric.values).toEqual([
      { labels: {}, bucketCounts: [1, 2, 2], sum: 355, count: 3 },
    ]);
  });

  it("returns the same handle for repeated creates and rejects type conflicts", () => {
    const registry = createMetricsRegistry();
    const first = registry.createCounter("dual_use");
    const second = registry.createCounter("dual_use");
    first.inc();
    second.inc();
    const [metric] = registry.toJSON().metrics;
    if (metric.type === "histogram") throw new Error("expected counter");
    expect(metric.values[0].value).toBe(2);
    expect(() => registry.createGauge("dual_use")).toThrow(
      /already registered/,
    );
    expect(() => registry.createCounter("bad name")).toThrow(
      /invalid metric name/,
    );
  });

  it("renders Prometheus exposition format for counters and gauges", () => {
    const registry = createMetricsRegistry();
    registry
      .createCounter("http_errors_total", { help: "HTTP errors." })
      .inc(3, { route: "/home", status: "500" });
    registry.createGauge("build_info", { help: "Build info." }).set(1);

    const text = registry.toPrometheusText();
    expect(text).toContain("# HELP http_errors_total HTTP errors.\n");
    expect(text).toContain("# TYPE http_errors_total counter\n");
    expect(text).toContain('http_errors_total{route="/home",status="500"} 3\n');
    expect(text).toContain("# TYPE build_info gauge\n");
    expect(text).toContain("\nbuild_info 1\n");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("renders histogram _bucket/_sum/_count samples with a +Inf bucket", () => {
    const registry = createMetricsRegistry();
    const histogram = registry.createHistogram("latency_seconds", {
      help: "Latency.",
      buckets: [0.1, 0.5],
    });
    histogram.observe(0.05, { route: "/home" });
    histogram.observe(0.3, { route: "/home" });
    histogram.observe(2, { route: "/home" });

    const text = registry.toPrometheusText();
    expect(text).toContain("# TYPE latency_seconds histogram\n");
    expect(text).toContain(
      'latency_seconds_bucket{route="/home",le="0.1"} 1\n',
    );
    expect(text).toContain(
      'latency_seconds_bucket{route="/home",le="0.5"} 2\n',
    );
    expect(text).toContain(
      'latency_seconds_bucket{route="/home",le="+Inf"} 3\n',
    );
    expect(text).toContain('latency_seconds_sum{route="/home"} 2.35\n');
    expect(text).toContain('latency_seconds_count{route="/home"} 3\n');
  });

  it("escapes label values and help text", () => {
    const registry = createMetricsRegistry();
    registry
      .createCounter("odd_total", { help: "Line1\nLine2 \\ slash" })
      .inc(1, { path: 'a"b\\c\nd' });

    const text = registry.toPrometheusText();
    expect(text).toContain("# HELP odd_total Line1\\nLine2 \\\\ slash\n");
    expect(text).toContain('odd_total{path="a\\"b\\\\c\\nd"} 1\n');
  });

  it("resets series while keeping registered metrics", () => {
    const registry = createMetricsRegistry();
    const counter = registry.createCounter("resettable_total");
    counter.inc(4);
    registry.reset();
    const [metric] = registry.toJSON().metrics;
    if (metric.type === "histogram") throw new Error("expected counter");
    expect(metric.values).toEqual([]);
    counter.inc();
    expect(registry.toPrometheusText()).toContain("resettable_total 1\n");
  });
});

describe("createHttpMetrics", () => {
  it("records request count and duration in seconds", () => {
    const registry = createMetricsRegistry();
    const httpMetrics = createHttpMetrics(registry);
    httpMetrics.recordRequest({
      method: "get",
      route: "/home",
      statusCode: 200,
      durationMs: 250,
    });
    httpMetrics.recordRequest({
      method: "GET",
      route: "/home",
      statusCode: 200,
      durationMs: 80,
    });

    const text = registry.toPrometheusText();
    expect(text).toContain(
      'http_requests_total{method="GET",route="/home",status="200"} 2\n',
    );
    expect(text).toContain("# TYPE http_request_duration_seconds histogram\n");
    expect(text).toContain(
      'http_request_duration_seconds_bucket{method="GET",route="/home",status="200",le="0.1"} 1\n',
    );
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/home",status="200"} 2\n',
    );
    expect(text).toContain(
      'http_request_duration_seconds_sum{method="GET",route="/home",status="200"} 0.33',
    );
  });
});

describe("recordWebVital", () => {
  it("records LCP into a histogram and a last-value gauge per route", () => {
    const registry = createMetricsRegistry();
    recordWebVital(registry, { name: "LCP", value: 1800, route: "/home" });
    recordWebVital(registry, { name: "LCP", value: 2600, route: "/home" });

    const text = registry.toPrometheusText();
    expect(text).toContain("# TYPE web_vitals_lcp histogram\n");
    expect(text).toContain(
      'web_vitals_lcp_bucket{route="/home",le="2000"} 1\n',
    );
    expect(text).toContain(
      'web_vitals_lcp_bucket{route="/home",le="+Inf"} 2\n',
    );
    expect(text).toContain('web_vitals_lcp_count{route="/home"} 2\n');
    expect(text).toContain("# TYPE web_vitals_lcp_last gauge\n");
    expect(text).toContain('web_vitals_lcp_last{route="/home"} 2600\n');
  });

  it("uses per-vital buckets and defaults the route label", () => {
    const registry = createMetricsRegistry();
    recordWebVital(registry, { name: "CLS", value: 0.12 });

    const snapshot = registry.toJSON();
    const histogram = snapshot.metrics.find(
      (metric) => metric.name === "web_vitals_cls",
    );
    if (histogram?.type !== "histogram") throw new Error("expected histogram");
    expect(histogram.buckets).toEqual([0.05, 0.1, 0.15, 0.25, 0.5, 1]);
    expect(histogram.values[0].labels).toEqual({ route: "unknown" });
    expect(histogram.values[0].count).toBe(1);
  });

  it("rejects unknown vital names from untrusted payloads", () => {
    const registry = createMetricsRegistry();
    expect(() =>
      recordWebVital(registry, {
        name: "FID" as unknown as "LCP",
        value: 10,
      }),
    ).toThrow(/unknown web vital/);
  });
});
