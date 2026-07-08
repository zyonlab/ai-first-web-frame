import type { RequestTraceSnapshot, TraceNode } from "@mvp/observability";
import type { PageHealth, SchedulerHint } from "@mvp/runtime";

/**
 * Framework-observability drawer: turns the raw scheduler-health text dump into
 * a bottom drawer with a request-trace waterfall. Fully server-rendered — the
 * bars are plain CSS (`left`/`width` percentages off each span's start/duration)
 * and the open/close is a native `<details>`, so it needs zero client JS and
 * degrades cleanly with no-JS. Data comes from `trace.toJSON()`.
 */
type TraceDrawerProps = {
  snapshot: RequestTraceSnapshot;
  health: PageHealth;
  hints: SchedulerHint[];
};

/** Human labels per span kind, shown in the legend + used for the color key. */
const KIND_LABEL: Record<string, string> = {
  request: "request",
  network: "network",
  fragment: "fragment",
  custom: "compute",
  cache: "cache",
};

/** Depth of a node in the parent chain, for waterfall indentation. */
function depthOf(node: TraceNode, byId: Map<string, TraceNode>): number {
  let depth = 0;
  let parentId = node.parentId;
  const seen = new Set<string>();
  while (parentId && byId.has(parentId) && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = byId.get(parentId)?.parentId;
  }
  return depth;
}

export function TraceDrawer({ snapshot, health, hints }: TraceDrawerProps) {
  const t0 = snapshot.startedAtMs;
  const spanEnd = (n: TraceNode) => n.endedAtMs ?? n.startedAtMs;
  const total = Math.max(
    1,
    snapshot.durationMs ?? Math.max(t0, ...snapshot.nodes.map(spanEnd)) - t0,
  );
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const rows = [...snapshot.nodes].sort(
    (a, b) => a.startedAtMs - b.startedAtMs || a.id.localeCompare(b.id),
  );
  const kinds = Array.from(new Set(rows.map((n) => n.kind)));

  return (
    <details className="trace-drawer">
      <summary className="trace-drawer__tab">
        <span className="trace-drawer__tab-dot" data-health={health} />
        Diagnostics — {total.toFixed(1)}ms · {rows.length} spans · health{" "}
        {health}
      </summary>
      <div className="trace-drawer__panel" data-scheduler-health="trade">
        <div className="trace-drawer__head">
          <strong>Request waterfall</strong>
          <span className="trace-drawer__meta">
            trace {snapshot.traceId.slice(0, 8)} · {total.toFixed(1)}ms total ·
            page health{" "}
            <b className="trace-drawer__health" data-health={health}>
              {health}
            </b>
          </span>
          <span className="trace-drawer__legend">
            {kinds.map((k) => (
              <span key={k} className="trace-drawer__legend-item">
                <span className="trace-wf__dot" data-kind={k} />
                {KIND_LABEL[k] ?? k}
              </span>
            ))}
          </span>
        </div>

        <div
          className="trace-wf"
          role="img"
          aria-label="Request trace waterfall"
        >
          <div className="trace-wf__axis" aria-hidden="true">
            <span>0ms</span>
            <span>{(total / 2).toFixed(1)}</span>
            <span>{total.toFixed(1)}ms</span>
          </div>
          <ul className="trace-wf__rows" data-field="slot-status">
            {rows.map((n) => {
              const depth = depthOf(n, byId);
              const start = n.startedAtMs - t0;
              const dur = n.durationMs ?? 0;
              const left = Math.min(100, Math.max(0, (start / total) * 100));
              const width = Math.max(0.6, (dur / total) * 100);
              return (
                <li className="trace-wf__row" key={n.id} data-slot={n.name}>
                  <div
                    className="trace-wf__label"
                    style={{ paddingLeft: `${depth * 12}px` }}
                    title={n.name}
                  >
                    <span className="trace-wf__dot" data-kind={n.kind} />
                    <span className="trace-wf__name">{n.name}</span>
                  </div>
                  <div className="trace-wf__track">
                    <span
                      className="trace-wf__bar"
                      data-kind={n.kind}
                      data-status={n.status ?? "ok"}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                    <span
                      className="trace-wf__dur"
                      style={{ left: `${Math.min(left + width, 84)}%` }}
                    >
                      {dur.toFixed(1)}ms
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="trace-drawer__hints" data-field="scheduler-hints">
          <strong>
            Scheduler hints{hints.length > 0 ? ` (${hints.length})` : ""}
          </strong>
          {hints.length === 0 ? (
            <p data-hints="empty">No waterfall hints — the plan is optimal.</p>
          ) : (
            <ul>
              {hints.map((hint) => (
                <li
                  key={`${hint.kind}:${hint.slots.join(",")}`}
                  data-hint={hint.kind}
                >
                  {hint.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  );
}
