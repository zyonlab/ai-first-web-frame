import { describe, expect, it } from "vitest";
import {
  createInMemoryLogSink,
  createRequestTrace,
  createTraceSpan,
  logEvent,
  measureDuration,
} from "./index";

describe("@mvp/observability", () => {
  it("logs events and duration for sync and async functions", async () => {
    const sink = createInMemoryLogSink();
    logEvent("custom", { traceId: "trace-1" });
    await expect(measureDuration("sync", () => 42)).resolves.toBe(42);
    await expect(measureDuration("async", async () => "ok")).resolves.toBe(
      "ok",
    );
    expect(sink.events.some((event) => event.eventName === "duration")).toBe(
      true,
    );
  });

  it("records duration when a function throws", async () => {
    const sink = createInMemoryLogSink();
    await expect(
      measureDuration("bad", () => {
        throw new Error("bad");
      }),
    ).rejects.toThrow("bad");
    expect(sink.events.some((event) => event.payload.name === "bad")).toBe(
      true,
    );
  });

  it("creates async trace spans with traceId", async () => {
    const sink = createInMemoryLogSink();
    await createTraceSpan(
      "render",
      { traceId: "trace-abc" },
      async () => "done",
    );
    expect(
      sink.events.find((event) => event.eventName === "span:start")?.payload
        .traceId,
    ).toBe("trace-abc");
  });

  it("builds a request dependency graph with durations", () => {
    let time = 0;
    const trace = createRequestTrace({
      traceId: "trace-graph",
      requestId: "req-graph",
      now: () => {
        time += 5;
        return time;
      },
    });
    const request = trace.startSpan("request", "request");
    const slot = trace.startSpan("slot:promotion", "fragment", {
      parentId: request,
      attributes: { strategy: "cached-ssr" },
    });
    trace.endSpan(slot, { status: "ok", attributes: { source: "network" } });
    trace.endSpan(request, { status: "ok" });

    const snapshot = trace.toJSON();
    expect(snapshot.traceId).toBe("trace-graph");
    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.nodes[1].durationMs).toBe(5);
    expect(snapshot.edges).toEqual([
      { from: request, to: slot, type: "parent" },
    ]);
    expect(trace.toDependencyGraphLog()).toContain("slot:promotion ok 5.00ms");
  });
});
