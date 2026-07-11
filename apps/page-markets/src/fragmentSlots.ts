import type { FragmentRegistry } from "@mvp/contracts";
import { createRequestTrace } from "@mvp/observability";
import { fragmentRegistry } from "@mvp/registry";
import { createRequestContext } from "@mvp/request-context";
import {
  type FragmentRenderResponse,
  type FragmentSlotDefinition,
  type FragmentSlotResult,
  type FragmentSlotsExecution,
  type PageHealth,
  type SchedulerHint,
  streamFragmentSlots,
} from "@mvp/runtime";
import { fragmentSlots as generatedMarketsSlots } from "./fragmentSlots.gen";

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
  // Raw scheduler output, keyed by slot name — feeds `<FragmentSlot>`
  // (`@mvp/runtime/react`) directly so `app/markets/page.tsx` never
  // hand-writes a per-slot `dangerouslySetInnerHTML` block (refactor plan
  // §3.3).
  execution: FragmentSlotsExecution;
};

/**
 * The diagnostics/scheduler-health/trace-log slice of the page — everything
 * that inherently needs the FULL aggregate result, and therefore can only
 * resolve once the single `marketsTable` slot's node finishes (refactor plan
 * §4.4, same split as page-home). Kept as its own type so
 * `app/markets/page.tsx` can feed it to its own `<Suspense>` boundary.
 */
export type MarketsFragmentAggregate = {
  diagnostics: Record<MarketsSlotKey, MarketsSlotDiagnostic>;
  scheduler: {
    health: PageHealth;
    hints: SchedulerHint[];
  };
  traceLog: string;
};

export type MarketsFragmentSlotPromises = Record<
  MarketsSlotKey,
  Promise<FragmentRenderResponse>
>;

export type MarketsFragmentStream = {
  slots: MarketsFragmentSlotPromises;
  /** Raw scheduler aggregate (`@mvp/runtime` shape); settles last. */
  execution: Promise<FragmentSlotsExecution>;
  /** Page-shaped diagnostics/scheduler/traceLog, derived from `execution`. */
  aggregate: Promise<MarketsFragmentAggregate>;
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
 * The page-markets runtime slots array. The static shape (fragment, channel,
 * strategy, cachePolicy, required) is generated from `manifest.slots.json`
 * by `scripts/mount-slot.mts` (refactor plan §3.2 — see
 * `./fragmentSlots.gen.ts`, regenerate via `pnpm exec tsx
 * scripts/mount-slot.mts --page page-markets --slot <name> --fragment
 * <fragment> [...flags]`); this wrapper only adds the one thing that isn't a
 * manifest fact — the per-request timeout override callers pass to
 * `fetchMarketsFragmentSlots` (tests use a short timeout to keep failure
 * cases fast). Static slots never fetch over the network, so they never
 * carry a timeout.
 */
export function buildMarketsSlotDefinitions(
  timeoutMs = 200,
): FragmentSlotDefinition[] {
  return generatedMarketsSlots.map((slot) =>
    slot.strategy === "static" ? slot : { ...slot, timeoutMs },
  );
}

/**
 * Streaming entry point (refactor plan §4.4, W3-A): kicks off the same
 * scheduling `fetchMarketsFragmentSlots` always ran, but returns IMMEDIATELY
 * — before the `marketsTable` slot has resolved — exposing its promise plus
 * one aggregate promise for the diagnostics/scheduler-health/trace-log
 * section. `app/markets/page.tsx` awaits `slots.marketsTable` inside its own
 * `<Suspense>`+`<FragmentSlotStream>` boundary so the static shell can flush
 * ahead of the fragment fetch, instead of the whole page blocking on one
 * `await`.
 */
export function streamMarketsFragmentSlots({
  headers,
  fetchImpl,
  timeoutMs = 200,
  registry = fragmentRegistry,
}: FetchMarketsFragmentSlotsOptions = {}): MarketsFragmentStream {
  const ctx = createRequestContext({ headers });
  const trace = createRequestTrace({
    traceId: ctx.traceId,
    requestId: ctx.requestId,
  });

  const stream = streamFragmentSlots({
    registry,
    ctx,
    fetchImpl,
    timeoutMs,
    trace,
    onRequiredFailure: "fallback",
    slots: buildMarketsSlotDefinitions(timeoutMs),
  });

  const aggregate = stream.result.then(
    (execution): MarketsFragmentAggregate => {
      const diagnostics = {} as Record<MarketsSlotKey, MarketsSlotDiagnostic>;
      for (const key of MARKETS_SLOT_KEYS) {
        diagnostics[key] = toDiagnostic(execution.slots[key]);
      }
      return {
        diagnostics,
        scheduler: {
          health: execution.health,
          hints: execution.hints,
        },
        traceLog: trace.toDependencyGraphLog(),
      };
    },
  );

  return {
    slots: { marketsTable: stream.slots.marketsTable },
    execution: stream.result,
    aggregate,
  };
}

/**
 * Compose the markets page's single fragment slot through the runtime
 * scheduler. `markets-table` is a `cached-ssr` fragment (near-realtime table;
 * doc 01 §5), rendered once and served no-JS-readable. When the fragment is not
 * yet registered (or its service is down) the slot degrades to a readable
 * fallback instead of breaking the page.
 *
 * Barrier-style entry point, kept for every caller that still wants one
 * blocking `await` (tests, and any future non-streaming consumer). Built ON
 * TOP OF `streamMarketsFragmentSlots` — it just awaits every promise the
 * stream exposes and assembles the same `MarketsFragmentHtml` shape this
 * function has always returned — so the two stay behaviorally identical by
 * construction.
 */
export async function fetchMarketsFragmentSlots(
  options: FetchMarketsFragmentSlotsOptions = {},
): Promise<MarketsFragmentHtml> {
  const stream = streamMarketsFragmentSlots(options);
  const [marketsTable, aggregate, execution] = await Promise.all([
    stream.slots.marketsTable,
    stream.aggregate,
    stream.execution,
  ]);

  return {
    slots: { marketsTable: marketsTable.html },
    diagnostics: aggregate.diagnostics,
    scheduler: aggregate.scheduler,
    traceLog: aggregate.traceLog,
    execution,
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
