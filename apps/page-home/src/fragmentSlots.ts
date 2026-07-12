import {
  createDataClient,
  type DataReadResult,
  defineDataSource,
} from "@mvp/data";
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
import { fragmentSlots as generatedHomeSlots } from "./fragmentSlots.gen";

const FEATURED_CONTENT_ID = "home-featured-content";

export type HomeSlotDiagnostic = FragmentSlotDiagnostic;

/**
 * The diagnostics/scheduler-health/trace-log slice of the page — everything
 * that inherently needs the FULL aggregate result (every slot's status,
 * every data dependency), and therefore can only resolve once the slowest
 * slot does (refactor plan §4.4). Kept as its own type so `app/page.tsx` can
 * feed it to a single `<Suspense>` boundary independent of the three
 * fragment slots.
 */
export type HomeFragmentAggregate = {
  diagnostics: Record<string, HomeSlotDiagnostic>;
  dataDiagnostics: {
    featuredContent: {
      firstRead: string;
      secondRead: string;
      title: string;
    };
  };
  scheduler: {
    health: PageHealth;
    hints: SchedulerHint[];
  };
  traceLog: string;
};

export type HomeFragmentHtml = {
  // Per-slot resolved HTML, keyed by slot name (whatever names
  // `fragmentSlots.gen.ts` currently enumerates — see `buildHomeSlotDefinitions`).
  // Generic on purpose (A1 gate, refactor plan §3): adding/removing a slot in
  // the manifest changes the keys this map has at runtime without any type or
  // code edit here.
  html: Record<string, string | null>;
  diagnostics: Record<string, HomeSlotDiagnostic>;
  dataDiagnostics: HomeFragmentAggregate["dataDiagnostics"];
  scheduler: HomeFragmentAggregate["scheduler"];
  traceLog: string;
  // Raw scheduler output, keyed by slot name — feeds `<FragmentSlot>`
  // (`@mvp/runtime/react`) directly so callers that still want the full
  // synchronous barrier never hand-write a per-slot `dangerouslySetInnerHTML`
  // block (refactor plan §3.3).
  execution: FragmentSlotsExecution;
};

/**
 * The fragment-slot promises `streamHomeFragmentSlots` exposes, one per
 * `<FragmentSlotStream>` boundary in `app/page.tsx` (refactor plan §4.4).
 * Each resolves independently, as soon as that slot's own DAG level
 * finishes. Deliberately generic (`Record<string, ...>`, not a hand-written
 * interface with one field per slot name): `@mvp/runtime`'s
 * `streamFragmentSlots` already returns exactly this shape (see
 * `FragmentSlotStreamHandle.slots` in `packages/runtime/src/index.ts`), keyed
 * by whatever `buildHomeSlotDefinitions()` (sourced from the generated
 * `fragmentSlots.gen.ts`) enumerates — there is no named-slot coupling left
 * to hand-maintain here. `app/page.tsx` still looks up individual keys
 * (`stream.slotPromises["promotion"]`) because CHOOSING which slots get their own
 * `<Suspense>` boundary and what fallback markup they render is genuine
 * human-judgment JSX placement (A1's explicit carve-out) — not something
 * codegen can or should decide.
 */
export type HomeFragmentStream = PageFragmentStream<HomeFragmentAggregate>;

type FetchFragmentSlotsOptions = {
  headers?: Headers;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * The page-home runtime slots array. The static shape (fragment, channel,
 * strategy, props, cachePolicy, dataDependencies, staticHtml, required) is
 * generated from `manifest.slots.json` by `scripts/mount-slot.mts`
 * (refactor plan §3.2 — see `./fragmentSlots.gen.ts`, regenerate via
 * `pnpm exec tsx scripts/mount-slot.mts --page page-home --slot <name>
 * --fragment <fragment> [...flags]`); this wrapper only adds the one thing
 * that isn't a manifest fact — the per-request timeout override callers pass
 * to `streamHomeFragmentSlots`/`fetchHomeFragmentSlots` (tests use a short
 * timeout to keep failure cases fast). Static slots never fetch over the
 * network, so they never carry a timeout.
 */
export function buildHomeSlotDefinitions(
  timeoutMs = 200,
): FragmentSlotDefinition[] {
  return applySlotRequestOverrides(generatedHomeSlots, { timeoutMs });
}

/**
 * Streaming entry point (refactor plan §4.4): kicks off the same DAG-aware
 * scheduling `fetchHomeFragmentSlots` always ran, but returns IMMEDIATELY —
 * before any slot has resolved — exposing one promise per fragment slot plus
 * one aggregate promise for the diagnostics/scheduler-health/trace-log
 * section. `app/page.tsx` awaits each of `slotPromises.*` inside its own
 * `<Suspense>`+`<FragmentSlotStream>` boundary so the static shell and any
 * already-settled slot can flush to the client ahead of slower siblings,
 * instead of the whole page blocking on one `await`.
 */
export function streamHomeFragmentSlots({
  headers,
  fetchImpl,
  timeoutMs = 200,
}: FetchFragmentSlotsOptions = {}): HomeFragmentStream {
  const ctx = createRequestContext({ headers });
  const trace = createRequestTrace({
    traceId: ctx.traceId,
    requestId: ctx.requestId,
  });
  const featuredContent = defineDataSource({
    id: FEATURED_CONTENT_ID,
    dependency: {
      id: FEATURED_CONTENT_ID,
      owner: "page",
      source: "server-function",
      freshness: "isr",
      privacy: "tenant",
      cachePolicy: {
        ttl: 120,
        tags: ["home", "featured-content"],
        vary: ["tenant", "locale", "props"],
      },
      invalidationTags: ["home:featured-content"],
      dependsOn: [],
    },
    load: async () => ({
      title: ctx.locale.startsWith("zh") ? "精选内容" : "Featured content",
    }),
  });
  const dataClient = createDataClient({
    ctx,
    trace,
    sources: [featuredContent],
  });

  // Shared read result for the featured-content data node. The scheduler
  // exposes it as a single data dependency; both the slot that requires it
  // and the diagnostics aggregate below read the same deduped result.
  const featuredReads: {
    first: DataReadResult<{ title: string }> | null;
    second: DataReadResult<{ title: string }> | null;
  } = { first: null, second: null };

  const stream = streamFragmentSlots({
    registry: fragmentRegistry,
    ctx,
    fetchImpl,
    timeoutMs,
    trace,
    onRequiredFailure: "fallback",
    dataDependencies: [{ id: FEATURED_CONTENT_ID, dependsOn: [] }],
    resolveData: async (id) => {
      if (id !== FEATURED_CONTENT_ID)
        throw new Error(`unknown data dependency "${id}"`);
      // Two concurrent reads of the same source prove request-level dedupe:
      // the second read observes the first read's in-flight loader ("pending").
      const [first, second] = await Promise.all([
        dataClient.readData<{ title: string }>(FEATURED_CONTENT_ID, {
          route: "home",
        }),
        dataClient.readData<{ title: string }>(FEATURED_CONTENT_ID, {
          route: "home",
        }),
      ]);
      featuredReads.first = first;
      featuredReads.second = second;
      return first.data;
    },
    slots: buildHomeSlotDefinitions(timeoutMs),
  });

  const aggregate = stream.result.then((execution): HomeFragmentAggregate => {
    const featuredTitle =
      featuredReads.first?.data.title ??
      (ctx.locale.startsWith("zh") ? "精选内容" : "Featured content");
    return {
      // Generic per-slot diagnostics (`@mvp/runtime`'s
      // `collectSlotDiagnostics`): the map key IS the slot's name, so no
      // slot names are hand-listed here.
      diagnostics: collectSlotDiagnostics(execution.slots),
      dataDiagnostics: {
        featuredContent: {
          firstRead: featuredReads.first?.source ?? "loader",
          secondRead: featuredReads.second?.source ?? "pending",
          title: featuredTitle,
        },
      },
      scheduler: {
        health: execution.health,
        hints: execution.hints,
      },
      traceLog: trace.toDependencyGraphLog(),
    };
  });

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
 * TOP OF `streamHomeFragmentSlots` — it just awaits every promise the stream
 * exposes and assembles the same `HomeFragmentHtml` shape this function has
 * always returned — so the two stay behaviorally identical by construction.
 */
export async function fetchHomeFragmentSlots(
  options: FetchFragmentSlotsOptions = {},
): Promise<HomeFragmentHtml> {
  const { html, aggregate, execution } = await resolveFragmentStream(
    streamHomeFragmentSlots(options),
  );
  return { html, ...aggregate, execution };
}
