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

export type MarketsSlotDiagnostic = Pick<
  FragmentSlotResult,
  "source" | "strategy"
> & {
  status: FragmentSlotResult["status"];
  required: boolean;
};

export type MarketsFragmentHtml = {
  // Per-slot resolved HTML, keyed by slot name (whatever names
  // `fragmentSlots.gen.ts` currently enumerates — see
  // `buildMarketsSlotDefinitions`). Generic on purpose (A1 gate, refactor
  // plan §3): adding/removing a slot in the manifest changes the keys this
  // map has at runtime without any type or code edit here.
  html: Record<string, string | null>;
  diagnostics: Record<string, MarketsSlotDiagnostic>;
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
  diagnostics: Record<string, MarketsSlotDiagnostic>;
  scheduler: {
    health: PageHealth;
    hints: SchedulerHint[];
  };
  traceLog: string;
};

/**
 * The fragment-slot promises `streamMarketsFragmentSlots` exposes, one per
 * `<FragmentSlotStream>` boundary in `app/markets/page.tsx` (refactor plan
 * §4.4). Deliberately generic (`Record<string, ...>`, not a hand-written
 * interface with one field per slot name): `@mvp/runtime`'s
 * `streamFragmentSlots` already returns exactly this shape (see
 * `FragmentSlotStreamHandle.slots` in `packages/runtime/src/index.ts`), keyed
 * by whatever `buildMarketsSlotDefinitions()` (sourced from the generated
 * `fragmentSlots.gen.ts`) enumerates — there is no named-slot coupling left
 * to hand-maintain here. `app/markets/page.tsx` still looks up the individual
 * key (`stream.slots.marketsTable`) because CHOOSING which slots get their
 * own `<Suspense>` boundary and what fallback markup they render is genuine
 * human-judgment JSX placement (A1's explicit carve-out) — not something
 * codegen can or should decide.
 */
export type MarketsFragmentStream = {
  slots: Record<string, Promise<FragmentRenderResponse>>;
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
      // Generic per-slot diagnostics: every slot's result carries everything
      // `toDiagnostic` needs (source/strategy/status/required), and the map
      // key IS the slot's name, so there is no genuine reason to hand-list
      // slot names here — iterate `execution.slots` (already `Record<string,
      // FragmentSlotResult>`, see `packages/runtime/src/index.ts`) instead of
      // repeating the (currently single) slot name.
      const diagnostics: Record<string, MarketsSlotDiagnostic> =
        Object.fromEntries(
          Object.entries(execution.slots).map(([name, result]) => [
            name,
            toDiagnostic(result),
          ]),
        );
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
    // `stream.slots` (`@mvp/runtime`'s `FragmentSlotStreamHandle.slots`) is
    // already `Record<string, Promise<FragmentRenderResponse>>` — passed
    // through as-is instead of re-listing each slot name into a new object.
    slots: stream.slots,
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
  // Resolve every slot's promise generically (whatever names `stream.slots`
  // currently has) instead of destructuring a single named field — the
  // "final returned HTML-string map" the A1 refactor targets.
  const [htmlEntries, aggregate, execution] = await Promise.all([
    Promise.all(
      Object.entries(stream.slots).map(async ([name, slotPromise]) => {
        const response = await slotPromise;
        return [name, response.html] as const;
      }),
    ),
    stream.aggregate,
    stream.execution,
  ]);

  return {
    html: Object.fromEntries(htmlEntries),
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
