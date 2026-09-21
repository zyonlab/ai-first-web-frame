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
    source?: unknown;
    traceparent?: unknown;
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

  // The trace id travels with the sample so a client-side vital can be joined
  // to the server spans of the same page load. `recordWebVital` aggregates and
  // deliberately drops per-sample detail, so it is echoed rather than silently
  // discarded — an ingestion endpoint that accepts a field and forgets it is
  // indistinguishable from one that never received it.
  const traceparent =
    typeof record.traceparent === "string" ? record.traceparent : undefined;

  return Response.json({
    status: "recorded",
    name: record.name,
    source: typeof record.source === "string" ? record.source : "unknown",
    ...(traceparent ? { traceparent } : {}),
  });
}

/** Exposes the accumulated RUM metrics as Prometheus text for scraping. */
export async function GET(): Promise<Response> {
  return new Response(metricsRegistry.toPrometheusText(), {
    headers: { "content-type": "text/plain; version=0.0.4" },
  });
}
