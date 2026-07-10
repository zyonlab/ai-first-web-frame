import {
  createDataClient,
  type DataReadResult,
  defineDataSource,
} from "@mvp/data";
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
import { fragmentSlots as generatedHomeSlots } from "./fragmentSlots.gen";

const FEATURED_CONTENT_ID = "home-featured-content";

export type HomeSlotDiagnostic = Pick<
  FragmentSlotResult,
  "source" | "strategy"
> & {
  status: FragmentSlotResult["status"];
  required: boolean;
};

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
  staticEditorial: string | null;
  promotion: string | null;
  recommendations: string | null;
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
 * The three named fragment-slot promises `streamHomeFragmentSlots` exposes,
 * one per `<FragmentSlotStream>` boundary in `app/page.tsx` (refactor plan
 * §4.4). Each resolves independently, as soon as that slot's own DAG level
 * finishes — `staticEditorial` and `recommendations` have no dependencies
 * (level 0), `promotion` depends on the shared featured-content data node
 * (level 1), so in practice the first two settle strictly before the third.
 */
export type HomeFragmentSlotPromises = {
  staticEditorial: Promise<FragmentRenderResponse>;
  promotion: Promise<FragmentRenderResponse>;
  recommendations: Promise<FragmentRenderResponse>;
};

export type HomeFragmentStream = {
  slots: HomeFragmentSlotPromises;
  /** Raw scheduler aggregate (`@mvp/runtime` shape); settles last. */
  execution: Promise<FragmentSlotsExecution>;
  /** Page-shaped diagnostics/dataDiagnostics/scheduler/traceLog, derived from `execution`. */
  aggregate: Promise<HomeFragmentAggregate>;
};

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
  return generatedHomeSlots.map((slot) =>
    slot.strategy === "static" ? slot : { ...slot, timeoutMs },
  );
}

/**
 * Streaming entry point (refactor plan §4.4): kicks off the same DAG-aware
 * scheduling `fetchHomeFragmentSlots` always ran, but returns IMMEDIATELY —
 * before any slot has resolved — exposing one promise per fragment slot plus
 * one aggregate promise for the diagnostics/scheduler-health/trace-log
 * section. `app/page.tsx` awaits each of `slots.*` inside its own
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
    const slots = execution.slots;
    const featuredTitle =
      featuredReads.first?.data.title ??
      (ctx.locale.startsWith("zh") ? "精选内容" : "Featured content");
    return {
      diagnostics: {
        staticEditorial: toDiagnostic(slots.staticEditorial),
        promotion: toDiagnostic(slots.promotion),
        recommendations: toDiagnostic(slots.recommendations),
      },
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
    slots: {
      staticEditorial: stream.slots.staticEditorial,
      promotion: stream.slots.promotion,
      recommendations: stream.slots.recommendations,
    },
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
  const stream = streamHomeFragmentSlots(options);
  const [staticEditorial, promotion, recommendations, aggregate, execution] =
    await Promise.all([
      stream.slots.staticEditorial,
      stream.slots.promotion,
      stream.slots.recommendations,
      stream.aggregate,
      stream.execution,
    ]);

  return {
    staticEditorial: staticEditorial.html,
    promotion: promotion.html,
    recommendations: recommendations.html,
    diagnostics: aggregate.diagnostics,
    dataDiagnostics: aggregate.dataDiagnostics,
    scheduler: aggregate.scheduler,
    traceLog: aggregate.traceLog,
    execution,
  };
}

function toDiagnostic(result: FragmentSlotResult): HomeSlotDiagnostic {
  return {
    source: result.source,
    strategy: result.strategy,
    status: result.status,
    required: result.slot.required ?? false,
  };
}
