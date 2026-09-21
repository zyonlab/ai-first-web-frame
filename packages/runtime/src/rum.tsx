"use client";

/**
 * `<RumBeacon />` — the one line a page adds to report real-user metrics.
 *
 * Browser-only, so it is a separate `@mvp/runtime/rum` entry carrying
 * `"use client"`, the same shape as `@mvp/runtime/live`. A server bundle never
 * pulls it in.
 *
 * It exists because the measurement lived in one page's feature island, which
 * meant six of the seven pages reported nothing — including `page-trade`, the
 * realtime terminal where interaction latency is the thing anyone would
 * actually want measured. Telemetry that has to be hand-wired per page ends up
 * wired on the page that needed it least.
 *
 * Renders nothing. Installs observers on mount, tears them down on unmount.
 */

import {
  createRumReporter,
  observeLongTasks,
  observeWebVitals,
} from "@mvp/observability/rum";
import { useEffect } from "react";

/**
 * Long tasks below this are ordinary work; above it they are the main-thread
 * blocks a user perceives as jank. 200ms is the INP "needs improvement"
 * boundary, so the two read on the same scale.
 */
export const DEFAULT_LONG_TASK_MS = 200;

/** The gateway's ingestion route. Same origin for every page, by construction. */
export const DEFAULT_RUM_ENDPOINT = "/_shell/rum";

export type RumBeaconProps = {
  /** Defaults to the gateway's shared endpoint. */
  endpoint?: string;
  /** Defaults to `location.pathname`, which is what a dashboard wants to group by. */
  route?: string;
  /** Long-task threshold in milliseconds. */
  longTaskMs?: number;
};

export function RumBeacon({
  endpoint = DEFAULT_RUM_ENDPOINT,
  route,
  longTaskMs = DEFAULT_LONG_TASK_MS,
}: RumBeaconProps): null {
  useEffect(() => {
    const report = createRumReporter({ endpoint, ...(route ? { route } : {}) });
    const stopVitals = observeWebVitals(report);
    // A long task is not a web vital, but it lands on the same scale as INP and
    // answers the follow-up question: which script blocked the thread.
    const stopTasks = observeLongTasks((task) => {
      if (task.durationMs >= longTaskMs) {
        report({ name: "INP", value: task.durationMs, source: "observer" });
      }
    });
    return () => {
      stopVitals();
      stopTasks();
    };
  }, [endpoint, route, longTaskMs]);

  return null;
}
