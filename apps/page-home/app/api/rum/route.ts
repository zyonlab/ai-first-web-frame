import {
  createMetricsRegistry,
  recordWebVital,
  type WebVitalName,
} from "@mvp/observability";

/**
 * Real-user-monitoring ingestion endpoint. The client island beacons web-vital
 * samples here; each is recorded into a process-level metrics registry via
 * `recordWebVital`. A future exporter can scrape `metricsRegistry` as
 * Prometheus text; kept minimal for the demo.
 */
export const dynamic = "force-dynamic";

const metricsRegistry = createMetricsRegistry();

const WEB_VITAL_NAMES: WebVitalName[] = ["LCP", "INP", "CLS", "TTFB"];

function isWebVitalName(value: unknown): value is WebVitalName {
  return (
    typeof value === "string" && (WEB_VITAL_NAMES as string[]).includes(value)
  );
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { status: "error", reason: "invalid-json" },
      {
        status: 400,
      },
    );
  }

  const record = payload as {
    name?: unknown;
    value?: unknown;
    route?: unknown;
  };
  if (!isWebVitalName(record.name) || typeof record.value !== "number") {
    return Response.json(
      { status: "error", reason: "invalid-metric" },
      {
        status: 400,
      },
    );
  }

  recordWebVital(metricsRegistry, {
    name: record.name,
    value: record.value,
    route: typeof record.route === "string" ? record.route : "/",
  });

  return Response.json({ status: "recorded", name: record.name });
}

/** Exposes the accumulated RUM metrics as Prometheus text for scraping. */
export async function GET(): Promise<Response> {
  return new Response(metricsRegistry.toPrometheusText(), {
    headers: { "content-type": "text/plain; version=0.0.4" },
  });
}
