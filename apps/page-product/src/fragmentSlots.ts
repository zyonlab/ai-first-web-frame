import { createRequestTrace } from "@mvp/observability";
import { fragmentRegistry } from "@mvp/registry";
import { createRequestContext } from "@mvp/request-context";
import {
  type DataResolutionResult,
  type FragmentRenderResponse,
  type FragmentSlotDefinition,
  type FragmentSlotResult,
  type FragmentSlotsExecution,
  type PageHealth,
  type SchedulerHint,
  streamFragmentSlots,
} from "@mvp/runtime";
import {
  enqueueProductStatsJob,
  getProductStatsWorker,
} from "./backgroundJobs";
import { fragmentSlots as generatedProductSlots } from "./fragmentSlots.gen";
import {
  type RecentlyViewedResult,
  trackRecentlyViewed,
} from "./recentlyViewed";

export type ProductFragmentHtml = {
  // Per-slot resolved HTML, keyed by slot name (whatever names
  // `fragmentSlots.gen.ts` currently enumerates — see `buildProductSlotDefinitions`).
  // Generic on purpose (A1 gate, refactor plan §3): adding/removing a slot in
  // the manifest changes the keys this map has at runtime without any type or
  // code edit here.
  html: Record<string, string | null>;
  diagnostics: Record<string, Pick<FragmentSlotResult, "source" | "strategy">>;
  dataDiagnostics: {
    productSummary: {
      firstRead: string;
      secondRead: string;
      label: string;
    };
  };
  /** DAG data-dependency diagnostics from executeFragmentSlots. */
  dag: {
    health: PageHealth;
    hints: SchedulerHint[];
    /** Number of times each data node's resolver was invoked (dedupe proof). */
    resolveCounts: Record<string, number>;
    data: Record<string, DataResolutionResult["status"]>;
  };
  recentlyViewed: RecentlyViewedResult;
  backgroundJobs: {
    taskId: string;
    status: string;
    stats: { queued: number; running: number; deadLetters: number };
  };
  traceLog: string;
  // Raw scheduler output, keyed by slot name — feeds `<FragmentSlot>`
  // (`@mvp/runtime/react`) directly so `app/product/[id]/page.tsx` never
  // hand-writes a per-slot `dangerouslySetInnerHTML` block (refactor plan
  // §3.3, additive field mirroring page-home's `execution`).
  execution: FragmentSlotsExecution;
};

/**
 * The diagnostics/dataDiagnostics/dag/recentlyViewed/backgroundJobs/
 * trace-log slice of the page — everything that inherently needs the FULL
 * aggregate result (every slot's status, every data dependency) or is
 * independent per-request work that isn't itself a fragment slot (the
 * recently-viewed cookie, the background stats job), and therefore can only
 * resolve once the slowest slot AND that other work settles (refactor plan
 * §4.4, same split as page-home). Kept as its own type so
 * `app/product/[id]/page.tsx` can feed it to a single `<Suspense>` boundary
 * independent of the three fragment slots.
 */
export type ProductFragmentAggregate = {
  diagnostics: Record<string, Pick<FragmentSlotResult, "source" | "strategy">>;
  dataDiagnostics: {
    productSummary: {
      firstRead: string;
      secondRead: string;
      label: string;
    };
  };
  /** DAG data-dependency diagnostics from executeFragmentSlots. */
  dag: {
    health: PageHealth;
    hints: SchedulerHint[];
    /** Number of times each data node's resolver was invoked (dedupe proof). */
    resolveCounts: Record<string, number>;
    data: Record<string, DataResolutionResult["status"]>;
  };
  recentlyViewed: RecentlyViewedResult;
  backgroundJobs: {
    taskId: string;
    status: string;
    stats: { queued: number; running: number; deadLetters: number };
  };
  traceLog: string;
};

/**
 * The fragment-slot promises `streamProductFragmentSlots` exposes, one per
 * `<FragmentSlotStream>` boundary in `app/product/[id]/page.tsx` (refactor
 * plan §4.4). Each resolves independently, as soon as that slot's own DAG
 * level finishes. Deliberately generic (`Record<string, ...>`, not a
 * hand-written interface with one field per slot name): `@mvp/runtime`'s
 * `streamFragmentSlots` already returns exactly this shape (see
 * `FragmentSlotStreamHandle.slots` in `packages/runtime/src/index.ts`), keyed
 * by whatever `buildProductSlotDefinitions()` (sourced from the generated
 * `fragmentSlots.gen.ts`) enumerates — there is no named-slot coupling left
 * to hand-maintain here. `app/product/[id]/page.tsx` still looks up
 * individual keys (`stream.slots["promotion"]`) because CHOOSING which slots
 * get their own `<Suspense>` boundary and what fallback markup they render is
 * genuine human-judgment JSX placement (A1's explicit carve-out) — not
 * something codegen can or should decide. Note `price-panel` never appears
 * here: it is `reserved: true` in the manifest, so `fragmentSlots.gen.ts`
 * (and therefore `stream.slots`) never enumerates it in the first place.
 */
export type ProductFragmentStream = {
  slots: Record<string, Promise<FragmentRenderResponse>>;
  /** Raw scheduler aggregate (`@mvp/runtime` shape); settles last. */
  execution: Promise<FragmentSlotsExecution>;
  /** Page-shaped diagnostics/dag/recentlyViewed/backgroundJobs, derived from `execution` plus the independent per-request work. */
  aggregate: Promise<ProductFragmentAggregate>;
};

type FetchProductFragmentSlotsOptions = {
  headers?: Headers;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  cookieHeader?: string;
  productId?: string;
  /** Await the background job before returning (tests/demo determinism). */
  awaitBackgroundJob?: boolean;
  now?: () => number;
};

/**
 * The page-product runtime slots array. The static shape (fragment, channel,
 * strategy, props, cachePolicy, dataDependencies, staticHtml, required) is
 * generated from `manifest.slots.json` by `scripts/mount-slot.mts` (refactor
 * plan §3.2 — see `./fragmentSlots.gen.ts`, regenerate via
 * `pnpm exec tsx scripts/mount-slot.mts --page page-product --slot <name>
 * --fragment <fragment> [...flags]`); this wrapper only adds the one thing
 * that isn't a manifest fact — the per-request timeout override callers pass
 * to `fetchProductFragmentSlots`. Static slots never fetch over the network,
 * so they never carry a timeout.
 *
 * Deliberately does NOT include `price-panel`: the manifest marks it
 * `reserved: true` because it is hand-rendered as a static aside in
 * `app/product/[id]/page.tsx`, not fetched through the runtime scheduler —
 * the codegen in `packages/registry/src/codegen.ts` already drops `reserved`
 * slots from `fragmentSlots.gen.ts`.
 */
export function buildProductSlotDefinitions(
  timeoutMs = 200,
): FragmentSlotDefinition[] {
  return generatedProductSlots.map((slot) =>
    slot.strategy === "static" ? slot : { ...slot, timeoutMs },
  );
}

/**
 * Streaming entry point (refactor plan §4.4, W3-A): kicks off the same
 * DAG-aware scheduling `fetchProductFragmentSlots` always ran, but returns
 * IMMEDIATELY — before any slot has resolved — exposing one promise per
 * fragment slot plus one aggregate promise for the diagnostics/dag/
 * recentlyViewed/backgroundJobs/trace-log section. `app/product/[id]/page.tsx`
 * awaits each of `slots.*` inside its own `<Suspense>`+`<FragmentSlotStream>`
 * boundary so the static shell and any already-settled slot can flush to the
 * client ahead of slower siblings, instead of the whole page blocking on one
 * `await`.
 *
 * The recently-viewed cookie lookup and the background-stats-job enqueue are
 * independent per-request work — neither is a fragment slot — so they are
 * kicked off alongside the scheduler (not serialized after it) and folded
 * into the same `aggregate` promise.
 */
export function streamProductFragmentSlots({
  headers,
  fetchImpl,
  timeoutMs = 200,
  cookieHeader = headers?.get("cookie") ?? "",
  productId = "123",
  awaitBackgroundJob = false,
  now,
}: FetchProductFragmentSlotsOptions = {}): ProductFragmentStream {
  const ctx = createRequestContext({ headers });
  const trace = createRequestTrace({
    traceId: ctx.traceId,
    requestId: ctx.requestId,
  });

  // --- DAG data dependencies -------------------------------------------------
  // product-summary is the root; price and promotion data both depend on it.
  // resolveData is invoked at most once per node, which we assert via counts.
  const resolveCounts: Record<string, number> = {
    "product-summary": 0,
    "product-price": 0,
    "product-promotion": 0,
  };
  const summaryLabel = ctx.locale.startsWith("zh")
    ? "商品摘要"
    : "Product summary";
  const resolveData = async (id: string): Promise<unknown> => {
    resolveCounts[id] = (resolveCounts[id] ?? 0) + 1;
    if (id === "product-summary") return { label: summaryLabel, productId };
    if (id === "product-price") return { price: "$79" };
    if (id === "product-promotion") return { campaignId: "product-launch" };
    return undefined;
  };

  const stream = streamFragmentSlots({
    registry: fragmentRegistry,
    ctx,
    fetchImpl,
    timeoutMs,
    trace,
    dataDependencies: [
      { id: "product-summary", dependsOn: [] },
      { id: "product-price", dependsOn: ["product-summary"] },
      { id: "product-promotion", dependsOn: ["product-summary"] },
    ],
    resolveData,
    slots: buildProductSlotDefinitions(timeoutMs),
  });

  // --- Signed cookie storage (recently viewed) ------------------------------
  const recentlyViewedPromise = trackRecentlyViewed({
    ctx,
    productId,
    cookieHeader,
  });

  // --- Background worker (recompute stats / warm recommendations) -----------
  const worker = getProductStatsWorker(now);
  const job = enqueueProductStatsJob({
    productId,
    tenant: ctx.tenant,
    traceId: ctx.traceId,
    requestId: ctx.requestId,
    now,
  });
  const backgroundJobsPromise = (async () => {
    let jobStatus = "queued";
    if (awaitBackgroundJob) {
      const result = await job.completion;
      jobStatus = result.status;
    }
    return {
      taskId: job.taskId,
      status: jobStatus,
      stats: worker.stats(),
    };
  })();

  const aggregate = Promise.all([
    stream.result,
    recentlyViewedPromise,
    backgroundJobsPromise,
  ]).then(
    ([execution, recentlyViewed, backgroundJobs]): ProductFragmentAggregate => {
      const summaryData = execution.data["product-summary"];
      const summaryValue = (summaryData?.value ?? {}) as { label?: string };
      // Generic per-slot diagnostics: every slot's result carries everything
      // `toDiagnostic` needs (source/strategy), and the map key IS the
      // slot's name, so there is no genuine reason to hand-list slot names
      // here — iterate `execution.slots` (already `Record<string,
      // FragmentSlotResult>`, see `packages/runtime/src/index.ts`) instead of
      // repeating the 3 current names.
      const diagnostics: Record<
        string,
        Pick<FragmentSlotResult, "source" | "strategy">
      > = Object.fromEntries(
        Object.entries(execution.slots).map(([name, result]) => [
          name,
          toDiagnostic(result),
        ]),
      );

      return {
        diagnostics,
        dataDiagnostics: {
          productSummary: {
            // The DAG resolves product-summary exactly once even though two
            // slots depend on data derived from it.
            firstRead: summaryData?.status ?? "error",
            secondRead: `resolved x${resolveCounts["product-summary"]}`,
            label: summaryValue.label ?? summaryLabel,
          },
        },
        dag: {
          health: execution.health,
          hints: execution.hints,
          resolveCounts,
          data: Object.fromEntries(
            Object.entries(execution.data).map(([id, result]) => [
              id,
              result.status,
            ]),
          ),
        },
        recentlyViewed,
        backgroundJobs,
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
 * Barrier-style entry point, kept for every caller that still wants one
 * blocking `await` (tests, and any future non-streaming consumer). Built ON
 * TOP OF `streamProductFragmentSlots` — it just awaits every promise the
 * stream exposes and assembles the same `ProductFragmentHtml` shape this
 * function has always returned — so the two stay behaviorally identical by
 * construction.
 */
export async function fetchProductFragmentSlots(
  options: FetchProductFragmentSlotsOptions = {},
): Promise<ProductFragmentHtml> {
  const stream = streamProductFragmentSlots(options);
  // Resolve every slot's promise generically (whatever names `stream.slots`
  // currently has) instead of destructuring three named fields — the
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
    dataDiagnostics: aggregate.dataDiagnostics,
    dag: aggregate.dag,
    recentlyViewed: aggregate.recentlyViewed,
    backgroundJobs: aggregate.backgroundJobs,
    traceLog: aggregate.traceLog,
    execution,
  };
}

function toDiagnostic(
  result: FragmentSlotResult,
): Pick<FragmentSlotResult, "source" | "strategy"> {
  return { source: result.source, strategy: result.strategy };
}
