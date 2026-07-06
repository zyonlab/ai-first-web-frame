type LogSink = {
  events: Array<{ eventName: string; payload: Record<string, unknown> }>;
  write: (eventName: string, payload: Record<string, unknown>) => void;
};

let activeSink: LogSink | undefined;

export type TraceSpanKind =
  | "request"
  | "scheduler"
  | "fragment"
  | "network"
  | "cache"
  | "static"
  | "data"
  | "custom";

export type TraceSpanStatus =
  | "ok"
  | "error"
  | "timeout"
  | "fallback"
  | "cache"
  | "static";

export type TraceNode = {
  id: string;
  name: string;
  kind: TraceSpanKind;
  parentId?: string;
  startedAtMs: number;
  endedAtMs?: number;
  durationMs?: number;
  status?: TraceSpanStatus;
  attributes: Record<string, unknown>;
};

export type TraceEdge = {
  from: string;
  to: string;
  type: "parent" | "depends-on" | "calls" | "uses-cache";
};

export type RequestTraceSnapshot = {
  traceId: string;
  requestId?: string;
  startedAtMs: number;
  endedAtMs?: number;
  durationMs?: number;
  nodes: TraceNode[];
  edges: TraceEdge[];
};

export type RequestTrace = {
  traceId: string;
  startSpan: (
    name: string,
    kind?: TraceSpanKind,
    options?: {
      parentId?: string;
      attributes?: Record<string, unknown>;
    },
  ) => string;
  endSpan: (
    spanId: string,
    options?: {
      status?: TraceSpanStatus;
      attributes?: Record<string, unknown>;
    },
  ) => void;
  addDependency: (from: string, to: string, type?: TraceEdge["type"]) => void;
  toJSON: () => RequestTraceSnapshot;
  toDependencyGraphLog: () => string;
};

type TraceOptions = {
  traceId: string;
  requestId?: string;
  now?: () => number;
};

export function createInMemoryLogSink(): LogSink {
  const sink: LogSink = {
    events: [],
    write(eventName, payload) {
      sink.events.push({ eventName, payload });
    },
  };
  activeSink = sink;
  return sink;
}

export function logEvent(
  eventName: string,
  payload: Record<string, unknown> = {},
) {
  activeSink?.write(eventName, payload);
}

export async function measureDuration<T>(
  name: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    logEvent("duration", { name, durationMs: performance.now() - startedAt });
  }
}

export async function createTraceSpan<T>(
  name: string,
  ctx: { traceId?: string },
  fn: () => T | Promise<T>,
): Promise<T> {
  logEvent("span:start", { name, traceId: ctx.traceId });
  try {
    return await measureDuration(name, fn);
  } finally {
    logEvent("span:end", { name, traceId: ctx.traceId });
  }
}

export function createRequestTrace({
  traceId,
  requestId,
  now = () => performance.now(),
}: TraceOptions): RequestTrace {
  const startedAtMs = now();
  const nodes = new Map<string, TraceNode>();
  const edges: TraceEdge[] = [];
  let sequence = 0;
  let endedAtMs: number | undefined;

  function nextId(name: string) {
    sequence += 1;
    return `${name.replace(/[^a-zA-Z0-9_-]/g, "-")}-${sequence}`;
  }

  const trace: RequestTrace = {
    traceId,
    startSpan(name, kind = "custom", options = {}) {
      const id = nextId(name);
      nodes.set(id, {
        id,
        name,
        kind,
        parentId: options.parentId,
        startedAtMs: now(),
        attributes: options.attributes ?? {},
      });
      if (options.parentId)
        edges.push({ from: options.parentId, to: id, type: "parent" });
      logEvent("trace:span:start", { traceId, spanId: id, name, kind });
      return id;
    },
    endSpan(spanId, options = {}) {
      const node = nodes.get(spanId);
      if (!node || node.endedAtMs !== undefined) return;
      const spanEndedAtMs = now();
      node.endedAtMs = spanEndedAtMs;
      node.durationMs = spanEndedAtMs - node.startedAtMs;
      node.status = options.status ?? "ok";
      node.attributes = { ...node.attributes, ...options.attributes };
      endedAtMs = spanEndedAtMs;
      logEvent("trace:span:end", {
        traceId,
        spanId,
        name: node.name,
        kind: node.kind,
        durationMs: node.durationMs,
        status: node.status,
      });
    },
    addDependency(from, to, type = "depends-on") {
      edges.push({ from, to, type });
    },
    toJSON() {
      const end = endedAtMs;
      return {
        traceId,
        requestId,
        startedAtMs,
        endedAtMs: end,
        durationMs: end === undefined ? undefined : end - startedAtMs,
        nodes: [...nodes.values()],
        edges,
      };
    },
    toDependencyGraphLog() {
      const snapshot = trace.toJSON();
      const lines = [
        `trace ${snapshot.traceId}${snapshot.requestId ? ` request ${snapshot.requestId}` : ""}`,
      ];
      for (const node of snapshot.nodes) {
        const duration =
          node.durationMs === undefined
            ? "open"
            : `${node.durationMs.toFixed(2)}ms`;
        lines.push(
          `node ${node.id} [${node.kind}] ${node.name} ${node.status ?? "open"} ${duration}`,
        );
      }
      for (const edge of snapshot.edges)
        lines.push(`edge ${edge.from} -> ${edge.to} (${edge.type})`);
      return lines.join("\n");
    },
  };

  return trace;
}
