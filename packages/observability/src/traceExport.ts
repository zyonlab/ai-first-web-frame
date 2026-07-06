import type { RequestTrace, RequestTraceSnapshot, TraceNode } from "./index";

export type TraceExporter = {
  export: (snapshot: RequestTraceSnapshot) => void | Promise<void>;
  flush?: () => void | Promise<void>;
  shutdown?: () => void | Promise<void>;
};

export type TraceSampler = {
  rate: number;
  shouldSample: (traceId: string) => boolean;
};

export type TraceExportPipeline = {
  exporters: TraceExporter[];
  sampler?: TraceSampler;
};

/**
 * FNV-1a 32-bit hash. Pure JS so sampling and OTLP id mapping stay
 * deterministic without pulling node:crypto into browser bundles.
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function hashToHex(input: string, byteLength: number): string {
  const chunkCount = Math.ceil((byteLength * 2) / 8);
  let hex = "";
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    hex += fnv1a32(`${chunk}:${input}`).toString(16).padStart(8, "0");
  }
  return hex.slice(0, byteLength * 2);
}

export function createTraceSampler({ rate }: { rate: number }): TraceSampler {
  const clampedRate = Math.min(1, Math.max(0, rate));
  return {
    rate: clampedRate,
    shouldSample(traceId) {
      if (clampedRate >= 1) return true;
      if (clampedRate <= 0) return false;
      const fraction = fnv1a32(traceId) / 0x1_0000_0000;
      return fraction < clampedRate;
    },
  };
}

export type FileTraceExporterOptions = {
  /** Directory for JSONL trace files. Defaults to `reports/traces`. */
  directory?: string;
  /** File name prefix so multiple services can share a directory. */
  serviceName?: string;
  now?: () => Date;
  onError?: (error: unknown) => void;
};

/**
 * Appends one JSON line per trace to `<directory>/<serviceName>-<date>.jsonl`.
 * Writes are funneled through a serial queue so concurrent exports never
 * interleave, and a `beforeExit` hook drains the queue before shutdown.
 */
export function createFileTraceExporter(
  options: FileTraceExporterOptions = {},
): TraceExporter {
  const {
    directory = "reports/traces",
    serviceName = "service",
    now = () => new Date(),
    onError = (error) =>
      console.error("[observability] file trace export failed", error),
  } = options;

  let queue: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task).catch(onError);
    return queue;
  };
  const flush = () => queue;
  const drainBeforeExit = () => {
    void flush();
  };
  const canHookProcess =
    typeof process !== "undefined" && typeof process.once === "function";
  if (canHookProcess) process.once("beforeExit", drainBeforeExit);

  return {
    export(snapshot) {
      const date = now().toISOString().slice(0, 10);
      const filePath = `${directory.replace(/\/+$/, "")}/${serviceName}-${date}.jsonl`;
      const line = `${JSON.stringify(snapshot)}\n`;
      return enqueue(async () => {
        const { appendFile, mkdir } = await import("node:fs/promises");
        await mkdir(directory, { recursive: true });
        await appendFile(filePath, line, "utf8");
      });
    },
    flush,
    shutdown() {
      if (canHookProcess) process.removeListener("beforeExit", drainBeforeExit);
      return flush();
    },
  };
}

export type ConsoleTraceExporterOptions = {
  write?: (line: string) => void;
};

/**
 * Emits each trace as a single structured JSON line on stdout so container
 * log collectors can pick traces up without extra infrastructure.
 */
export function createConsoleTraceExporter(
  options: ConsoleTraceExporterOptions = {},
): TraceExporter {
  const { write = (line) => console.log(line) } = options;
  return {
    export(snapshot) {
      write(JSON.stringify({ type: "request-trace", ...snapshot }));
    },
  };
}

export type OtlpAttributeValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean };

export type OtlpAttribute = { key: string; value: OtlpAttributeValue };

export type OtlpSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  status: { code: number; message?: string };
};

export type OtlpJsonTracePayload = {
  resourceSpans: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeSpans: Array<{
      scope: { name: string; version?: string };
      spans: OtlpSpan[];
    }>;
  }>;
};

const OTLP_SPAN_KIND_INTERNAL = 1;
const OTLP_SPAN_KIND_SERVER = 2;
const OTLP_SPAN_KIND_CLIENT = 3;
const OTLP_STATUS_CODE_UNSET = 0;
const OTLP_STATUS_CODE_OK = 1;
const OTLP_STATUS_CODE_ERROR = 2;

function toOtlpSpanKind(kind: TraceNode["kind"]): number {
  if (kind === "request") return OTLP_SPAN_KIND_SERVER;
  if (kind === "network") return OTLP_SPAN_KIND_CLIENT;
  return OTLP_SPAN_KIND_INTERNAL;
}

function toOtlpStatus(status: TraceNode["status"]): OtlpSpan["status"] {
  if (status === undefined) return { code: OTLP_STATUS_CODE_UNSET };
  if (status === "error" || status === "timeout") {
    return { code: OTLP_STATUS_CODE_ERROR, message: status };
  }
  return { code: OTLP_STATUS_CODE_OK };
}

function toOtlpAttributeValue(value: unknown): OtlpAttributeValue {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value };
  }
  return { stringValue: JSON.stringify(value) ?? "undefined" };
}

function toOtlpAttributes(
  attributes: Record<string, unknown>,
): OtlpAttribute[] {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: toOtlpAttributeValue(value),
  }));
}

function msToUnixNano(ms: number): string {
  return String(Math.round(ms * 1_000_000));
}

/**
 * Maps a RequestTraceSnapshot to the OTLP/JSON HTTP export shape
 * (resourceSpans -> scopeSpans -> spans). Trace and span ids are derived by
 * deterministic hashing so parent links survive the mapping.
 */
export function toOtlpJsonPayload(
  snapshot: RequestTraceSnapshot,
  options: { serviceName?: string; scopeName?: string } = {},
): OtlpJsonTracePayload {
  const { serviceName = "mvp-service", scopeName = "@mvp/observability" } =
    options;
  const traceIdHex = hashToHex(snapshot.traceId, 16);
  const spanIdHex = (spanId: string) =>
    hashToHex(`${snapshot.traceId}:${spanId}`, 8);

  const spans = snapshot.nodes.map((node) => {
    const attributes = toOtlpAttributes(node.attributes);
    attributes.push({
      key: "mvp.span.kind",
      value: { stringValue: node.kind },
    });
    if (snapshot.requestId !== undefined) {
      attributes.push({
        key: "mvp.request.id",
        value: { stringValue: snapshot.requestId },
      });
    }
    const span: OtlpSpan = {
      traceId: traceIdHex,
      spanId: spanIdHex(node.id),
      name: node.name,
      kind: toOtlpSpanKind(node.kind),
      startTimeUnixNano: msToUnixNano(node.startedAtMs),
      endTimeUnixNano: msToUnixNano(node.endedAtMs ?? node.startedAtMs),
      attributes,
      status: toOtlpStatus(node.status),
    };
    if (node.parentId !== undefined)
      span.parentSpanId = spanIdHex(node.parentId);
    return span;
  });

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: serviceName } },
          ],
        },
        scopeSpans: [{ scope: { name: scopeName }, spans }],
      },
    ],
  };
}

export type OtlpJsonTraceExporterOptions = {
  /** OTLP/HTTP traces endpoint. Defaults to the collector convention. */
  endpoint?: string;
  serviceName?: string;
  headers?: Record<string, string>;
  /** Override transport entirely; receives the mapped OTLP payload. */
  send?: (payload: OtlpJsonTracePayload) => Promise<void>;
  fetchImpl?: typeof fetch;
  onError?: (error: unknown) => void;
};

export function createOtlpJsonTraceExporter(
  options: OtlpJsonTraceExporterOptions = {},
): TraceExporter {
  const {
    endpoint = "http://localhost:4318/v1/traces",
    serviceName = "mvp-service",
    headers = {},
    fetchImpl = globalThis.fetch,
    onError = (error) =>
      console.error("[observability] OTLP trace export failed", error),
  } = options;

  const send =
    options.send ??
    (async (payload: OtlpJsonTracePayload) => {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(
          `OTLP trace export failed with status ${response.status}`,
        );
      }
    });

  const pending = new Set<Promise<void>>();
  const flush = async () => {
    await Promise.all(pending);
  };

  return {
    export(snapshot) {
      const task = send(toOtlpJsonPayload(snapshot, { serviceName })).catch(
        onError,
      );
      pending.add(task);
      void task.then(() => pending.delete(task));
      return task;
    },
    flush,
    shutdown: flush,
  };
}

let activePipeline: TraceExportPipeline | undefined;

/**
 * Installs the global trace export pipeline used by exportTrace. When never
 * called, createRequestTrace keeps its existing in-memory behavior.
 */
export function configureTraceExport(pipeline: TraceExportPipeline): void {
  activePipeline = pipeline;
}

export function resetTraceExport(): void {
  activePipeline = undefined;
}

function isRequestTrace(
  trace: RequestTrace | RequestTraceSnapshot,
): trace is RequestTrace {
  return typeof (trace as RequestTrace).toJSON === "function";
}

/**
 * Exports a finished trace through the configured pipeline. Returns true when
 * at least one exporter received the snapshot, false when the pipeline is not
 * configured or the sampler dropped the trace.
 */
export async function exportTrace(
  trace: RequestTrace | RequestTraceSnapshot,
): Promise<boolean> {
  const pipeline = activePipeline;
  if (!pipeline || pipeline.exporters.length === 0) return false;
  const snapshot = isRequestTrace(trace) ? trace.toJSON() : trace;
  if (pipeline.sampler && !pipeline.sampler.shouldSample(snapshot.traceId)) {
    return false;
  }
  await Promise.all(
    pipeline.exporters.map((exporter) => exporter.export(snapshot)),
  );
  return true;
}

export async function flushTraceExport(): Promise<void> {
  const pipeline = activePipeline;
  if (!pipeline) return;
  await Promise.all(pipeline.exporters.map((exporter) => exporter.flush?.()));
}

export async function shutdownTraceExport(): Promise<void> {
  const pipeline = activePipeline;
  if (!pipeline) return;
  await Promise.all(
    pipeline.exporters.map(
      (exporter) => exporter.shutdown?.() ?? exporter.flush?.(),
    ),
  );
  activePipeline = undefined;
}
