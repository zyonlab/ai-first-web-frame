import { describe, expect, it } from "vitest";
import {
  continueTrace,
  createSpanId,
  createTraceId,
  formatTraceparent,
  parseTraceparent,
} from "./traceContext";

/**
 * These tests exist because the bug this module replaced was a trace id that
 * was a hardcoded constant — every request in the system shared one, so nothing
 * could be correlated and nothing complained. Uniqueness and all-zero rejection
 * are therefore the load-bearing assertions, not the formatting.
 */

describe("id generation", () => {
  it("produces W3C-shaped ids", () => {
    expect(createTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(createSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("never produces the same trace id twice", () => {
    const ids = new Set(Array.from({ length: 500 }, createTraceId));
    expect(ids.size).toBe(500);
  });

  it("never produces an all-zero id, which the spec forbids", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(createTraceId()).not.toMatch(/^0+$/);
      expect(createSpanId()).not.toMatch(/^0+$/);
    }
  });
});

describe("parseTraceparent", () => {
  const valid = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

  it("parses the spec's own example", () => {
    expect(parseTraceparent(valid)).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      sampled: true,
    });
  });

  it("reads the sampled bit from the flags", () => {
    expect(parseTraceparent(valid.replace(/-01$/, "-00"))?.sampled).toBe(false);
  });

  it("accepts upper case and surrounding whitespace", () => {
    expect(parseTraceparent(`  ${valid.toUpperCase()} `)?.traceId).toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736",
    );
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["wrong field count", "00-abc-def"],
    ["short trace id", "00-4bf92f35-00f067aa0ba902b7-01"],
    ["non-hex", "00-zzf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"],
    [
      "all-zero trace id",
      "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
    ],
    [
      "all-zero span id",
      "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
    ],
    [
      "future version",
      "01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    ],
  ])("returns null for %s", (_label, value) => {
    expect(parseTraceparent(value)).toBeNull();
  });
});

describe("continueTrace", () => {
  const incoming = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

  it("keeps the incoming trace id and records the caller as parent", () => {
    const result = continueTrace(incoming);
    expect(result.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(result.parentSpanId).toBe("00f067aa0ba902b7");
  });

  it("always mints a fresh span id — this process is a new span", () => {
    expect(continueTrace(incoming).spanId).not.toBe("00f067aa0ba902b7");
  });

  it("starts a new trace with no parent when there is nothing to continue", () => {
    const result = continueTrace(undefined);
    expect(result.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(result.parentSpanId).toBeUndefined();
  });

  it("starts a new trace rather than adopting a malformed one", () => {
    // Accepting a partially valid parent would attach spans to a trace nobody
    // can query, which is worse than starting a clean one.
    const result = continueTrace("00-not-a-real-traceparent-01");
    expect(result.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(result.parentSpanId).toBeUndefined();
  });

  it("round-trips through the header it emits", () => {
    const result = continueTrace(incoming);
    expect(parseTraceparent(result.traceparent)).toEqual({
      traceId: result.traceId,
      spanId: result.spanId,
      sampled: true,
    });
  });

  it("propagates a not-sampled decision instead of re-deciding", () => {
    const result = continueTrace(incoming.replace(/-01$/, "-00"));
    expect(result.sampled).toBe(false);
    expect(formatTraceparent(result)).toMatch(/-00$/);
  });
});
