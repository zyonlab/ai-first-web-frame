import type { FragmentRegistry } from "@mvp/contracts";
import { createRequestTrace } from "@mvp/observability";
import { fragmentRegistry } from "@mvp/registry";
import { createRequestContext } from "@mvp/request-context";
import {
  applySlotRequestOverrides,
  collectSlotDiagnostics,
  type FragmentSlotDefinition,
  type FragmentSlotDiagnostic,
  type FragmentSlotsExecution,
  type PageFragmentStream,
  type PageHealth,
  resolveFragmentStream,
  type SchedulerHint,
  streamFragmentSlots,
} from "@mvp/runtime";
import { fragmentSlots as generatedPortfolioSlots } from "./fragmentSlots.gen";

export type PortfolioSlotDiagnostic = FragmentSlotDiagnostic;

export type PortfolioFragmentHtml = {
  // Per-slot resolved HTML, keyed by slot name (whatever names
  // `fragmentSlots.gen.ts` currently enumerates — see
  // `buildPortfolioSlotDefinitions`). Generic on purpose (A1 gate, refactor
  // plan §3): adding/removing a slot in the manifest changes the keys this
  // map has at runtime without any type or code edit here. null -> render
  // the panel fallback.
  html: Record<string, string | null>;
  diagnostics: Record<string, PortfolioSlotDiagnostic>;
  scheduler: {
    health: PageHealth;
    hints: SchedulerHint[];
  };
  traceLog: string;
  // Raw scheduler output, keyed by slot name — feeds `<FragmentSlot>`
  // (`@mvp/runtime/react`) directly so `app/portfolio/page.tsx` never
  // hand-writes a per-slot `dangerouslySetInnerHTML` block (refactor plan
  // §3.3).
  execution: FragmentSlotsExecution;
};

/**
 * The diagnostics/scheduler-health/trace-log slice of the page — everything
 * that inherently needs the FULL aggregate result, and therefore can only
 * resolve once the slowest of the two slots does (refactor plan §4.4, same
 * split as page-home). Kept as its own type so `app/portfolio/page.tsx` can
 * feed it to its own `<Suspense>` boundary independent of the two fragment
 * slots.
 */
export type PortfolioFragmentAggregate = {
  diagnostics: Record<string, PortfolioSlotDiagnostic>;
  scheduler: {
    health: PageHealth;
    hints: SchedulerHint[];
  };
  traceLog: string;
};

/**
 * The fragment-slot promises `streamPortfolioFragmentSlots` exposes, one per
 * `<FragmentSlotStream>` boundary in `app/portfolio/page.tsx` (refactor plan
 * §4.4). Deliberately generic (`Record<string, ...>`, not a hand-written
 * interface with one field per slot name): `@mvp/runtime`'s
 * `streamFragmentSlots` already returns exactly this shape (see
 * `FragmentSlotStreamHandle.slots` in `packages/runtime/src/index.ts`), keyed
 * by whatever `buildPortfolioSlotDefinitions()` (sourced from the generated
 * `fragmentSlots.gen.ts`) enumerates — there is no named-slot coupling left
 * to hand-maintain here. `app/portfolio/page.tsx` still looks up individual
 * keys (`stream.slotPromises.portfolioSummary`) because CHOOSING which slots get
 * their own `<Suspense>` boundary and what fallback markup they render is
 * genuine human-judgment JSX placement (A1's explicit carve-out) — not
 * something codegen can or should decide.
 */
export type PortfolioFragmentStream =
  PageFragmentStream<PortfolioFragmentAggregate>;

type FetchPortfolioFragmentSlotsOptions = {
  headers?: Headers;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Override the fragment registry (tests inject one; empty forces degrade). */
  registry?: FragmentRegistry;
};

/**
 * The page-portfolio runtime slots array. The static shape (fragment,
 * channel, strategy, cachePolicy, required) is generated from
 * `manifest.slots.json` by `scripts/mount-slot.mts` (refactor plan §3.2 —
 * see `./fragmentSlots.gen.ts`, regenerate via `pnpm exec tsx
 * scripts/mount-slot.mts --page page-portfolio --slot <name> --fragment
 * <fragment> [...flags]`); this wrapper only adds the one thing that isn't a
 * manifest fact — the per-request timeout override callers pass to
 * `fetchPortfolioFragmentSlots` (tests use a short timeout to keep failure
 * cases fast). Kept as a named export so it can still be diffed against
 * `manifest.slots.json` without making a real network call (refactor plan
 * §3.4 drift check; see `apps/page-portfolio/tests/manifestSync.test.ts`).
 */
export function buildPortfolioSlotDefinitions(
  timeoutMs = 200,
): FragmentSlotDefinition[] {
  return applySlotRequestOverrides(generatedPortfolioSlots, { timeoutMs });
}

/**
 * Compose the portfolio page's two fragment slots through the runtime
 * scheduler (doc 01 §4.4):
 *
 * - `portfolioSummary` (fragment `portfolio-summary`) — request-time
 *   `dynamic-ssr`: equity / margin usage / PnL are user-private and must not be
 *   cached, so they render fresh per request. Required: it is the page headline,
 *   so its failure reports the page degraded/unhealthy rather than silently
 *   empty.
 * - `pnlChart` (fragment `pnl-chart`) — `ttl-cache`: the cumulative PnL series
 *   is cache-friendly (revalidated on an interval), so it renders via a
 *   TTL-cached response.
 *   Optional: a missing chart degrades to a readable placeholder without
 *   failing the page.
 *
 * When a fragment is not yet registered (or its service is down) the slot
 * degrades to a readable fallback instead of breaking the page. Tests inject a
 * throwaway `registry` (including an empty `{ fragments: {} }` to force the
 * not-registered path) so the real `registry.data.json` is never touched.
 *
 * Streaming entry point (refactor plan §4.4, W3-A): kicks off the same
 * scheduling `fetchPortfolioFragmentSlots` always ran, but returns
 * IMMEDIATELY — before either slot has resolved — exposing one promise per
 * fragment slot plus one aggregate promise for the diagnostics/
 * scheduler-health/trace-log section. `app/portfolio/page.tsx` awaits each of
 * `slots.*` inside its own `<Suspense>`+`<FragmentSlotStream>` boundary so
 * the static shell and any already-settled slot can flush ahead of slower
 * siblings, instead of the whole page blocking on one `await`.
 */
export function streamPortfolioFragmentSlots({
  headers,
  fetchImpl,
  timeoutMs = 200,
  registry = fragmentRegistry,
}: FetchPortfolioFragmentSlotsOptions = {}): PortfolioFragmentStream {
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
    slots: buildPortfolioSlotDefinitions(timeoutMs),
  });

  const aggregate = stream.result.then(
    (execution): PortfolioFragmentAggregate => ({
      // Generic per-slot diagnostics (`@mvp/runtime`'s
      // `collectSlotDiagnostics`): the map key IS the slot's name, so no
      // slot names are hand-listed here.
      diagnostics: collectSlotDiagnostics(execution.slots),
      scheduler: {
        health: execution.health,
        hints: execution.hints,
      },
      traceLog: trace.toDependencyGraphLog(),
    }),
  );

  return {
    // `stream.slots` (`@mvp/runtime`'s `FragmentSlotStreamHandle.slots`) is
    // already `Record<string, Promise<FragmentRenderResponse>>` — passed
    // through as-is instead of re-listing each slot name into a new object.
    slotPromises: stream.slots,
    execution: stream.result,
    aggregate,
  };
}

/**
 * Barrier-style entry point, kept for every caller that still wants one
 * blocking `await` (tests, and any future non-streaming consumer). Built ON
 * TOP OF `streamPortfolioFragmentSlots` — it just awaits every promise the
 * stream exposes and assembles the same `PortfolioFragmentHtml` shape this
 * function has always returned — so the two stay behaviorally identical by
 * construction.
 */
export async function fetchPortfolioFragmentSlots(
  options: FetchPortfolioFragmentSlotsOptions = {},
): Promise<PortfolioFragmentHtml> {
  const { html, aggregate, execution } = await resolveFragmentStream(
    streamPortfolioFragmentSlots(options),
  );
  return { html, ...aggregate, execution };
}
