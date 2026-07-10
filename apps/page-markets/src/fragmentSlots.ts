import type { FragmentRegistry } from "@mvp/contracts";
import { createRequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import {
  executeFragmentSlots,
  type FragmentSlotDefinition,
  type FragmentSlotResult,
  type PageHealth,
  type SchedulerHint,
} from "@mvp/runtime";
import { fragmentRegistry } from "../../../platform/fragment-registry/src/registry";

/** Slot keys composed on the markets page (single main fragment). */
export type MarketsSlotKey = "marketsTable";

export type MarketsSlotDiagnostic = Pick<
  FragmentSlotResult,
  "source" | "strategy"
> & {
  status: FragmentSlotResult["status"];
  required: boolean;
};

export type MarketsFragmentHtml = {
  /** Rendered (or null) HTML per slot; null → render the panel fallback. */
  slots: Record<MarketsSlotKey, string | null>;
  diagnostics: Record<MarketsSlotKey, MarketsSlotDiagnostic>;
  scheduler: {
    health: PageHealth;
    hints: SchedulerHint[];
  };
  traceLog: string;
};

type FetchMarketsFragmentSlotsOptions = {
  headers?: Headers;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Override the fragment registry (tests inject one with markets-table). */
  registry?: FragmentRegistry;
};

const MARKETS_SLOT_KEYS: MarketsSlotKey[] = ["marketsTable"];

/**
 * The page-markets runtime slots array, factored out of
 * `fetchMarketsFragmentSlots` so it can be diffed against
 * `manifest.slots.json` without making a real network call (refactor plan
 * §3.4 drift check; see `apps/page-markets/tests/manifestSync.test.ts`).
 */
export function buildMarketsSlotDefinitions(
  timeoutMs = 200,
): FragmentSlotDefinition[] {
  return [
    {
      name: "marketsTable",
      fragment: "markets-table",
      channel: "canary",
      strategy: "cached-ssr",
      timeoutMs,
      // Required: the table is the page's only content — if it fails the page
      // is reported degraded/unhealthy, not silently empty.
      required: true,
      cachePolicy: {
        ttl: 5,
        tags: ["markets", "ticker"],
        vary: ["tenant", "locale", "props"],
      },
    },
  ];
}

/**
 * Compose the markets page's single fragment slot through the runtime
 * scheduler. `markets-table` is a `cached-ssr` fragment (near-realtime table;
 * doc 01 §5), rendered once and served no-JS-readable. When the fragment is not
 * yet registered (or its service is down) the slot degrades to a readable
 * fallback instead of breaking the page.
 */
export async function fetchMarketsFragmentSlots({
  headers,
  fetchImpl,
  timeoutMs = 200,
  registry = fragmentRegistry,
}: FetchMarketsFragmentSlotsOptions = {}): Promise<MarketsFragmentHtml> {
  const ctx = createRequestContext({ headers });
  const trace = createRequestTrace({
    traceId: ctx.traceId,
    requestId: ctx.requestId,
  });

  const execution = await executeFragmentSlots({
    registry,
    ctx,
    fetchImpl,
    timeoutMs,
    trace,
    onRequiredFailure: "fallback",
    slots: buildMarketsSlotDefinitions(timeoutMs),
  });

  const slots = {} as Record<MarketsSlotKey, string | null>;
  const diagnostics = {} as Record<MarketsSlotKey, MarketsSlotDiagnostic>;
  for (const key of MARKETS_SLOT_KEYS) {
    const result = execution.slots[key];
    slots[key] = result.response.html;
    diagnostics[key] = toDiagnostic(result);
  }

  return {
    slots,
    diagnostics,
    scheduler: {
      health: execution.health,
      hints: execution.hints,
    },
    traceLog: trace.toDependencyGraphLog(),
  };
}

function toDiagnostic(result: FragmentSlotResult): MarketsSlotDiagnostic {
  return {
    source: result.source,
    strategy: result.strategy,
    status: result.status,
    required: result.slot.required ?? false,
  };
}
