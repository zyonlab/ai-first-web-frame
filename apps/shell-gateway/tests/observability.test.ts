import { describe, expect, it } from "vitest";
import {
  createContentSecurityPolicy,
  createNonce,
  createShellMetrics,
  isMeteredRoute,
  PROMETHEUS_CONTENT_TYPE,
} from "../src/observability";

describe("shell observability helpers", () => {
  it("advertises the Prometheus 0.0.4 exposition content-type", () => {
    expect(PROMETHEUS_CONTENT_TYPE).toContain("text/plain");
    expect(PROMETHEUS_CONTENT_TYPE).toContain("version=0.0.4");
  });

  it("excludes /metrics and /health from metering", () => {
    expect(isMeteredRoute("/metrics")).toBe(false);
    expect(isMeteredRoute("/health")).toBe(false);
    expect(isMeteredRoute("/")).toBe(true);
    expect(isMeteredRoute("/product/:id")).toBe(true);
  });

  it("builds a CSP string that pins scripts to self plus the nonce", () => {
    const csp = createContentSecurityPolicy("abc123");
    expect(csp).toBe(
      "default-src 'self'; script-src 'self' 'nonce-abc123'; " +
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
  });

  it("generates unique, decodable base64 nonces", () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64").length).toBe(16);
  });

  it("registers the conventional HTTP metrics on the shared registry", () => {
    const metrics = createShellMetrics();
    metrics.http.recordRequest({
      method: "get",
      route: "/",
      statusCode: 200,
      durationMs: 12,
    });
    const text = metrics.registry.toPrometheusText();
    expect(text).toContain("http_requests_total");
    expect(text).toContain('method="GET"');
    expect(text).toContain('route="/"');
  });
});
