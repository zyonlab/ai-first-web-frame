export type MetricLabels = Record<string, string>;

export type Counter = {
  inc: (value?: number, labels?: MetricLabels) => void;
};

export type Gauge = {
  set: (value: number, labels?: MetricLabels) => void;
  inc: (value?: number, labels?: MetricLabels) => void;
  dec: (value?: number, labels?: MetricLabels) => void;
};

export type Histogram = {
  observe: (value: number, labels?: MetricLabels) => void;
};

export type ScalarMetricSnapshot = {
  name: string;
  type: "counter" | "gauge";
  help: string;
  values: Array<{ labels: MetricLabels; value: number }>;
};

export type HistogramMetricSnapshot = {
  name: string;
  type: "histogram";
  help: string;
  buckets: number[];
  values: Array<{
    labels: MetricLabels;
    /** Cumulative counts aligned with `buckets`. */
    bucketCounts: number[];
    sum: number;
    count: number;
  }>;
};

export type MetricsSnapshot = {
  metrics: Array<ScalarMetricSnapshot | HistogramMetricSnapshot>;
};

export type MetricsRegistry = {
  createCounter: (name: string, options?: { help?: string }) => Counter;
  createGauge: (name: string, options?: { help?: string }) => Gauge;
  createHistogram: (
    name: string,
    options?: { help?: string; buckets?: number[] },
  ) => Histogram;
  toPrometheusText: () => string;
  toJSON: () => MetricsSnapshot;
  reset: () => void;
};

const METRIC_NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

/** Default duration buckets in seconds, matching the Prometheus client default. */
export const DEFAULT_HISTOGRAM_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

type ScalarSeries = { labels: MetricLabels; value: number };
type HistogramSeries = {
  labels: MetricLabels;
  bucketCounts: number[];
  sum: number;
  count: number;
};

type MetricEntry =
  | {
      name: string;
      type: "counter" | "gauge";
      help: string;
      series: Map<string, ScalarSeries>;
      handle: Counter | Gauge;
    }
  | {
      name: string;
      type: "histogram";
      help: string;
      buckets: number[];
      series: Map<string, HistogramSeries>;
      handle: Histogram;
    };

function labelKey(labels: MetricLabels): string {
  return JSON.stringify(
    Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function escapeHelp(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function formatLabels(labels: MetricLabels, extra?: [string, string]): string {
  const pairs = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (extra) pairs.push(extra);
  if (pairs.length === 0) return "";
  const body = pairs
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(",");
  return `{${body}}`;
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`metric ${name} received a non-finite value: ${value}`);
  }
}

export function createMetricsRegistry(): MetricsRegistry {
  const entries = new Map<string, MetricEntry>();

  function getOrCreate<T extends MetricEntry>(
    name: string,
    type: MetricEntry["type"],
    create: () => T,
  ): T {
    if (!METRIC_NAME_PATTERN.test(name)) {
      throw new Error(`invalid metric name: ${name}`);
    }
    const existing = entries.get(name);
    if (existing) {
      if (existing.type !== type) {
        throw new Error(
          `metric ${name} already registered as ${existing.type}, cannot reuse as ${type}`,
        );
      }
      return existing as T;
    }
    const entry = create();
    entries.set(name, entry);
    return entry;
  }

  function scalarSeries(
    entry: Extract<MetricEntry, { type: "counter" | "gauge" }>,
    labels: MetricLabels,
  ): ScalarSeries {
    const key = labelKey(labels);
    let series = entry.series.get(key);
    if (!series) {
      series = { labels: { ...labels }, value: 0 };
      entry.series.set(key, series);
    }
    return series;
  }

  const registry: MetricsRegistry = {
    createCounter(name, options = {}) {
      const entry = getOrCreate(name, "counter", () => {
        const created: Extract<MetricEntry, { type: "counter" | "gauge" }> = {
          name,
          type: "counter",
          help: options.help ?? name,
          series: new Map(),
          handle: {
            inc(value = 1, labels = {}) {
              assertFinite(name, value);
              if (value < 0) {
                throw new Error(`counter ${name} cannot decrease`);
              }
              scalarSeries(created, labels).value += value;
            },
          },
        };
        return created;
      });
      return entry.handle as Counter;
    },
    createGauge(name, options = {}) {
      const entry = getOrCreate(name, "gauge", () => {
        const created: Extract<MetricEntry, { type: "counter" | "gauge" }> = {
          name,
          type: "gauge",
          help: options.help ?? name,
          series: new Map(),
          handle: {
            set(value: number, labels: MetricLabels = {}) {
              assertFinite(name, value);
              scalarSeries(created, labels).value = value;
            },
            inc(value = 1, labels: MetricLabels = {}) {
              assertFinite(name, value);
              scalarSeries(created, labels).value += value;
            },
            dec(value = 1, labels: MetricLabels = {}) {
              assertFinite(name, value);
              scalarSeries(created, labels).value -= value;
            },
          },
        };
        return created;
      });
      return entry.handle as Gauge;
    },
    createHistogram(name, options = {}) {
      const buckets = [...(options.buckets ?? DEFAULT_HISTOGRAM_BUCKETS)]
        .filter((bound, index, all) => all.indexOf(bound) === index)
        .sort((a, b) => a - b);
      if (buckets.length === 0 || buckets.some((b) => !Number.isFinite(b))) {
        throw new Error(`histogram ${name} requires finite bucket bounds`);
      }
      const entry = getOrCreate(name, "histogram", () => {
        const created: Extract<MetricEntry, { type: "histogram" }> = {
          name,
          type: "histogram",
          help: options.help ?? name,
          buckets,
          series: new Map(),
          handle: {
            observe(value, labels = {}) {
              assertFinite(name, value);
              const key = labelKey(labels);
              let series = created.series.get(key);
              if (!series) {
                series = {
                  labels: { ...labels },
                  bucketCounts: created.buckets.map(() => 0),
                  sum: 0,
                  count: 0,
                };
                created.series.set(key, series);
              }
              for (let i = 0; i < created.buckets.length; i += 1) {
                if (value <= created.buckets[i]) series.bucketCounts[i] += 1;
              }
              series.sum += value;
              series.count += 1;
            },
          },
        };
        return created;
      });
      return entry.handle as Histogram;
    },
    toPrometheusText() {
      const lines: string[] = [];
      for (const entry of entries.values()) {
        lines.push(`# HELP ${entry.name} ${escapeHelp(entry.help)}`);
        lines.push(`# TYPE ${entry.name} ${entry.type}`);
        if (entry.type === "histogram") {
          for (const series of entry.series.values()) {
            for (let i = 0; i < entry.buckets.length; i += 1) {
              lines.push(
                `${entry.name}_bucket${formatLabels(series.labels, ["le", String(entry.buckets[i])])} ${series.bucketCounts[i]}`,
              );
            }
            lines.push(
              `${entry.name}_bucket${formatLabels(series.labels, ["le", "+Inf"])} ${series.count}`,
            );
            lines.push(
              `${entry.name}_sum${formatLabels(series.labels)} ${series.sum}`,
            );
            lines.push(
              `${entry.name}_count${formatLabels(series.labels)} ${series.count}`,
            );
          }
        } else {
          for (const series of entry.series.values()) {
            lines.push(
              `${entry.name}${formatLabels(series.labels)} ${series.value}`,
            );
          }
        }
      }
      return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
    },
    toJSON() {
      const metrics: MetricsSnapshot["metrics"] = [];
      for (const entry of entries.values()) {
        if (entry.type === "histogram") {
          metrics.push({
            name: entry.name,
            type: "histogram",
            help: entry.help,
            buckets: [...entry.buckets],
            values: [...entry.series.values()].map((series) => ({
              labels: { ...series.labels },
              bucketCounts: [...series.bucketCounts],
              sum: series.sum,
              count: series.count,
            })),
          });
        } else {
          metrics.push({
            name: entry.name,
            type: entry.type,
            help: entry.help,
            values: [...entry.series.values()].map((series) => ({
              labels: { ...series.labels },
              value: series.value,
            })),
          });
        }
      }
      return { metrics };
    },
    reset() {
      for (const entry of entries.values()) entry.series.clear();
    },
  };

  return registry;
}

export type HttpMetrics = {
  requestsTotal: Counter;
  requestDurationSeconds: Histogram;
  recordRequest: (input: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
  }) => void;
};

/**
 * Registers the conventional HTTP server metrics and returns a convenience
 * recorder, meant to be called once per handled request by the server shell.
 */
export function createHttpMetrics(registry: MetricsRegistry): HttpMetrics {
  const requestsTotal = registry.createCounter("http_requests_total", {
    help: "Total number of HTTP requests handled.",
  });
  const requestDurationSeconds = registry.createHistogram(
    "http_request_duration_seconds",
    {
      help: "HTTP request duration in seconds.",
      buckets: DEFAULT_HISTOGRAM_BUCKETS,
    },
  );
  return {
    requestsTotal,
    requestDurationSeconds,
    recordRequest({ method, route, statusCode, durationMs }) {
      const labels = {
        method: method.toUpperCase(),
        route,
        status: String(statusCode),
      };
      requestsTotal.inc(1, labels);
      requestDurationSeconds.observe(durationMs / 1000, labels);
    },
  };
}

export type WebVitalName = "LCP" | "INP" | "CLS" | "TTFB";

const WEB_VITAL_BUCKETS: Record<WebVitalName, number[]> = {
  LCP: [500, 1000, 1500, 2000, 2500, 3000, 4000, 6000, 8000],
  INP: [50, 100, 200, 300, 500, 750, 1000],
  CLS: [0.05, 0.1, 0.15, 0.25, 0.5, 1],
  TTFB: [100, 200, 400, 600, 800, 1200, 2000],
};

const WEB_VITAL_HELP: Record<WebVitalName, string> = {
  LCP: "Largest Contentful Paint in milliseconds.",
  INP: "Interaction to Next Paint in milliseconds.",
  CLS: "Cumulative Layout Shift score.",
  TTFB: "Time to First Byte in milliseconds.",
};

/**
 * Records one real-user web vital sample into the registry: a histogram for
 * the distribution and a gauge holding the latest value per route. Intended
 * as the backend for a future RUM ingestion endpoint.
 */
export function recordWebVital(
  registry: MetricsRegistry,
  input: { name: WebVitalName; value: number; route?: string },
): void {
  const buckets = WEB_VITAL_BUCKETS[input.name];
  if (!buckets) {
    throw new Error(`unknown web vital: ${String(input.name)}`);
  }
  const metricName = `web_vitals_${input.name.toLowerCase()}`;
  const histogram = registry.createHistogram(metricName, {
    help: WEB_VITAL_HELP[input.name],
    buckets,
  });
  const lastGauge = registry.createGauge(`${metricName}_last`, {
    help: `${WEB_VITAL_HELP[input.name]} Latest reported value.`,
  });
  const labels = { route: input.route ?? "unknown" };
  histogram.observe(input.value, labels);
  lastGauge.set(input.value, labels);
}
