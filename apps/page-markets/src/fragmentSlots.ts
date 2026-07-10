import type { FragmentRegistry } from "@mvp/contracts";
import { createRequestTrace } from "@mvp/observability";
import { fragmentRegistry } from "@mvp/registry";
import { createRequestContext } from "@mvp/request-context";
import {
  executeFragmentSlots,
  type FragmentSlotDefinition,
  type FragmentSlotResult,
  type FragmentSlotsExecution,
  type PageHealth,
  type SchedulerHint,
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
