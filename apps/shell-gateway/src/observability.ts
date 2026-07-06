import { randomBytes } from "node:crypto";
import {
  configureTraceExport,
  createConsoleTraceExporter,
  createFileTraceExporter,
  createHttpMetrics,
  createMetricsRegistry,
  createTraceSampler,
  type HttpMetrics,
  type MetricsRegistry,
} from "@mvp/observability";

/** Content-Type expected by Prometheus scrapers for the text exposition format. */
export const PROMETHEUS_CONTENT_TYPE =
  "text/plain; version=0.0.4; charset=utf-8";

/** Routes that must not be counted in HTTP metrics to avoid self-observation noise. */
const UNMETERED_ROUTES = new Set(["/metrics", "/health"]);

export function isMeteredRoute(routeTemplate: string): boolean {
  return !UNMETERED_ROUTES.has(routeTemplate);
}

export type ShellMetrics = {
  registry: MetricsRegistry;
  http: HttpMetrics;
};

/**
 * Builds the process-level metrics surface: a registry plus the conventional
 * HTTP request counter and duration histogram.
 */
export function createShellMetrics(
  registry: MetricsRegistry = createMetricsRegistry(),
): ShellMetrics {
  return { registry, http: createHttpMetrics(registry) };
}

/** Generates a per-request base64 nonce for the CSP `script-src` allowlist. */
export function createNonce(bytes = 16): string {
  return randomBytes(bytes).toString("base64");
}

/**
 * Assembles the Content-Security-Policy header value. Keeps script execution
 * pinned to same-origin plus the per-request nonce and forbids plugins,
 * base-tag hijacking, and framing (GAP 2.6).
 */
export function createContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

let traceExportConfigured = false;

/**
 * Installs the global trace export pipeline exactly once per process. The demo
 * defaults to full sampling; `TRACE_SAMPLE_RATE` overrides the rate.
 */
export function ensureTraceExportConfigured(): void {
  if (traceExportConfigured) return;
  traceExportConfigured = true;
  const rate = parseSampleRate(process.env.TRACE_SAMPLE_RATE);
  configureTraceExport({
    exporters: [
      createFileTraceExporter({ serviceName: "shell-gateway" }),
      createConsoleTraceExporter(),
    ],
    sampler: createTraceSampler({ rate }),
  });
}

function parseSampleRate(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 1;
}
