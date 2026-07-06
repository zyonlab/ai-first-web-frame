import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RequestTraceSnapshot, TraceExporter } from "./index";
import {
  configureTraceExport,
  createConsoleTraceExporter,
  createFileTraceExporter,
  createOtlpJsonTraceExporter,
  createRequestTrace,
  createTraceSampler,
  exportTrace,
  flushTraceExport,
  resetTraceExport,
  shutdownTraceExport,
  toOtlpJsonPayload,
} from "./index";

function buildSnapshot(
  overrides: Partial<RequestTraceSnapshot> = {},
): RequestTraceSnapshot {
  return {
    traceId: "trace-export",
    requestId: "req-export",
    startedAtMs: 10,
    endedAtMs: 30,
    durationMs: 20,
    nodes: [
      {
        id: "request-1",
        name: "request",
        kind: "request",
        startedAtMs: 10,
        endedAtMs: 30,
        durationMs: 20,
        status: "ok",
        attributes: { route: "/home", retries: 2, sampled: true, ratio: 0.5 },
      },
      {
        id: "slot-promotion-2",
        name: "slot:promotion",
        kind: "network",
        parentId: "request-1",
        startedAtMs: 12,
        endedAtMs: 25,
        durationMs: 13,
        status: "error",
        attributes: {},
      },
    ],
    edges: [{ from: "request-1", to: "slot-promotion-2", type: "parent" }],
    ...overrides,
  };
}

afterEach(async () => {
  await shutdownTraceExport();
  resetTraceExport();
});

describe("createFileTraceExporter", () => {
  it("appends one JSON line per trace to a dated service file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mvp-traces-"));
    const exporter = createFileTraceExporter({
      directory,
      serviceName: "shell-gateway",
      now: () => new Date("2026-07-06T10:00:00.000Z"),
    });

    void exporter.export(buildSnapshot({ traceId: "trace-a" }));
    void exporter.export(buildSnapshot({ traceId: "trace-b" }));
    await exporter.flush?.();
    await exporter.shutdown?.();

    const content = await readFile(
      join(directory, "shell-gateway-2026-07-06.jsonl"),
      "utf8",
    );
    const lines = content.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).traceId).toBe("trace-a");
    expect(JSON.parse(lines[1]).traceId).toBe("trace-b");
  });

  it("serializes concurrent writes without interleaving lines", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mvp-traces-"));
    const exporter = createFileTraceExporter({
      directory,
      serviceName: "burst",
      now: () => new Date("2026-07-06T10:00:00.000Z"),
    });

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        exporter.export(buildSnapshot({ traceId: `trace-${index}` })),
      ),
    );
    await exporter.shutdown?.();

    const content = await readFile(
      join(directory, "burst-2026-07-06.jsonl"),
      "utf8",
    );
    const lines = content.trimEnd().split("\n");
    expect(lines).toHaveLength(20);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("reports write failures through onError instead of throwing", async () => {
    const onError = vi.fn();
    const exporter = createFileTraceExporter({
      directory: "/dev/null/not-a-directory",
      onError,
    });
    await exporter.export(buildSnapshot());
    await exporter.shutdown?.();
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("createConsoleTraceExporter", () => {
  it("writes a single structured JSON line per trace", () => {
    const lines: string[] = [];
    const exporter = createConsoleTraceExporter({
      write: (line) => lines.push(line),
    });
    exporter.export(buildSnapshot());

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe("request-trace");
    expect(parsed.traceId).toBe("trace-export");
    expect(parsed.nodes).toHaveLength(2);
  });
});

describe("toOtlpJsonPayload", () => {
  it("maps the snapshot to OTLP/JSON resourceSpans structure", () => {
    const payload = toOtlpJsonPayload(buildSnapshot(), {
      serviceName: "shell-gateway",
    });

    expect(payload.resourceSpans).toHaveLength(1);
    const [resourceSpan] = payload.resourceSpans;
    expect(resourceSpan.resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "shell-gateway" },
    });
    const [scopeSpan] = resourceSpan.scopeSpans;
    expect(scopeSpan.scope.name).toBe("@mvp/observability");
    expect(scopeSpan.spans).toHaveLength(2);
  });

  it("derives hex ids and preserves parent-child links", () => {
    const payload = toOtlpJsonPayload(buildSnapshot());
    const [root, child] = payload.resourceSpans[0].scopeSpans[0].spans;

    expect(root.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(root.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(root.parentSpanId).toBeUndefined();
    expect(child.traceId).toBe(root.traceId);
    expect(child.parentSpanId).toBe(root.spanId);
    expect(child.spanId).not.toBe(root.spanId);

    const again = toOtlpJsonPayload(buildSnapshot());
    expect(again.resourceSpans[0].scopeSpans[0].spans[0].spanId).toBe(
      root.spanId,
    );
  });

  it("maps kind, status, timestamps, and attribute value types", () => {
    const payload = toOtlpJsonPayload(buildSnapshot());
    const [root, child] = payload.resourceSpans[0].scopeSpans[0].spans;

    expect(root.kind).toBe(2);
    expect(child.kind).toBe(3);
    expect(root.status).toEqual({ code: 1 });
    expect(child.status).toEqual({ code: 2, message: "error" });
    expect(root.startTimeUnixNano).toBe("10000000");
    expect(root.endTimeUnixNano).toBe("30000000");

    expect(root.attributes).toContainEqual({
      key: "route",
      value: { stringValue: "/home" },
    });
    expect(root.attributes).toContainEqual({
      key: "retries",
      value: { intValue: "2" },
    });
    expect(root.attributes).toContainEqual({
      key: "sampled",
      value: { boolValue: true },
    });
    expect(root.attributes).toContainEqual({
      key: "ratio",
      value: { doubleValue: 0.5 },
    });
    expect(root.attributes).toContainEqual({
      key: "mvp.request.id",
      value: { stringValue: "req-export" },
    });
  });

  it("maps internal kinds and open spans safely", () => {
    const payload = toOtlpJsonPayload(
      buildSnapshot({
        requestId: undefined,
        nodes: [
          {
            id: "frag-1",
            name: "fragment",
            kind: "fragment",
            startedAtMs: 5,
            attributes: {},
          },
        ],
        edges: [],
      }),
    );
    const [span] = payload.resourceSpans[0].scopeSpans[0].spans;
    expect(span.kind).toBe(1);
    expect(span.status).toEqual({ code: 0 });
    expect(span.endTimeUnixNano).toBe(span.startTimeUnixNano);
  });
});

describe("createOtlpJsonTraceExporter", () => {
  it("sends the mapped payload through the injected send", async () => {
    const sent: unknown[] = [];
    const exporter = createOtlpJsonTraceExporter({
      serviceName: "shell-gateway",
      send: async (payload) => {
        sent.push(payload);
      },
    });
    await exporter.export(buildSnapshot());
    await exporter.flush?.();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(
      toOtlpJsonPayload(buildSnapshot(), { serviceName: "shell-gateway" }),
    );
  });

  it("POSTs OTLP JSON to the configured endpoint by default", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const exporter = createOtlpJsonTraceExporter({
      endpoint: "http://collector:4318/v1/traces",
      headers: { authorization: "Bearer token" },
      fetchImpl,
    });
    await exporter.export(buildSnapshot());

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://collector:4318/v1/traces");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer token",
    });
    const body = JSON.parse(init.body as string);
    expect(body.resourceSpans[0].scopeSpans[0].spans).toHaveLength(2);
  });

  it("routes transport failures to onError instead of throwing", async () => {
    const onError = vi.fn();
    const exporter = createOtlpJsonTraceExporter({
      fetchImpl: vi.fn(async () => new Response(null, { status: 503 })),
      onError,
    });
    await exporter.export(buildSnapshot());
    await exporter.flush?.();
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("createTraceSampler", () => {
  it("always samples at rate 1 and never at rate 0", () => {
    const always = createTraceSampler({ rate: 1 });
    const never = createTraceSampler({ rate: 0 });
    for (let index = 0; index < 50; index += 1) {
      expect(always.shouldSample(`trace-${index}`)).toBe(true);
      expect(never.shouldSample(`trace-${index}`)).toBe(false);
    }
  });

  it("gives a consistent decision for the same traceId", () => {
    const samplerA = createTraceSampler({ rate: 0.5 });
    const samplerB = createTraceSampler({ rate: 0.5 });
    for (let index = 0; index < 100; index += 1) {
      const traceId = `trace-${index}`;
      const decision = samplerA.shouldSample(traceId);
      expect(samplerA.shouldSample(traceId)).toBe(decision);
      expect(samplerB.shouldSample(traceId)).toBe(decision);
    }
  });

  it("samples roughly at the configured rate and clamps out-of-range rates", () => {
    const sampler = createTraceSampler({ rate: 0.5 });
    let sampled = 0;
    for (let index = 0; index < 1000; index += 1) {
      if (sampler.shouldSample(`trace-${index}`)) sampled += 1;
    }
    expect(sampled).toBeGreaterThan(350);
    expect(sampled).toBeLessThan(650);

    expect(createTraceSampler({ rate: 2 }).rate).toBe(1);
    expect(createTraceSampler({ rate: -1 }).rate).toBe(0);
  });
});

describe("configureTraceExport and exportTrace", () => {
  function createMemoryExporter() {
    const snapshots: RequestTraceSnapshot[] = [];
    const flush = vi.fn();
    const shutdown = vi.fn();
    const exporter: TraceExporter = {
      export(snapshot) {
        snapshots.push(snapshot);
      },
      flush,
      shutdown,
    };
    return { exporter, snapshots, flush, shutdown };
  }

  it("returns false when no pipeline is configured", async () => {
    await expect(exportTrace(buildSnapshot())).resolves.toBe(false);
  });

  it("fans a snapshot out to every configured exporter", async () => {
    const first = createMemoryExporter();
    const second = createMemoryExporter();
    configureTraceExport({ exporters: [first.exporter, second.exporter] });

    await expect(exportTrace(buildSnapshot())).resolves.toBe(true);
    expect(first.snapshots).toHaveLength(1);
    expect(second.snapshots).toHaveLength(1);
    expect(first.snapshots[0].traceId).toBe("trace-export");
  });

  it("accepts a live RequestTrace and serializes it", async () => {
    const memory = createMemoryExporter();
    configureTraceExport({ exporters: [memory.exporter] });

    const trace = createRequestTrace({ traceId: "trace-live" });
    const span = trace.startSpan("request", "request");
    trace.endSpan(span, { status: "ok" });

    await expect(exportTrace(trace)).resolves.toBe(true);
    expect(memory.snapshots[0].traceId).toBe("trace-live");
    expect(memory.snapshots[0].nodes).toHaveLength(1);
  });

  it("drops unsampled traces before exporters run", async () => {
    const memory = createMemoryExporter();
    configureTraceExport({
      exporters: [memory.exporter],
      sampler: createTraceSampler({ rate: 0 }),
    });
    await expect(exportTrace(buildSnapshot())).resolves.toBe(false);
    expect(memory.snapshots).toHaveLength(0);
  });

  it("flushes and shuts exporters down through the pipeline helpers", async () => {
    const memory = createMemoryExporter();
    configureTraceExport({ exporters: [memory.exporter] });

    await flushTraceExport();
    expect(memory.flush).toHaveBeenCalledOnce();

    await shutdownTraceExport();
    expect(memory.shutdown).toHaveBeenCalledOnce();
    await expect(exportTrace(buildSnapshot())).resolves.toBe(false);
  });

  it("keeps createRequestTrace behavior unchanged when unconfigured", () => {
    const trace = createRequestTrace({ traceId: "trace-compat" });
    const span = trace.startSpan("request", "request");
    trace.endSpan(span);
    expect(trace.toJSON().nodes).toHaveLength(1);
    expect(trace.toDependencyGraphLog()).toContain("trace trace-compat");
  });
});
