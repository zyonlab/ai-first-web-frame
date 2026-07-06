import { createRequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import {
  type DataResolutionResult,
  executeFragmentSlots,
  type FragmentSlotResult,
  type PageHealth,
  type SchedulerHint,
} from "@mvp/runtime";
import { fragmentRegistry } from "../../../platform/fragment-registry/src/registry";
import {
  enqueueProductStatsJob,
  getProductStatsWorker,
} from "./backgroundJobs";
import {
  type RecentlyViewedResult,
  trackRecentlyViewed,
} from "./recentlyViewed";

export type ProductFragmentHtml = {
  staticProof: string | null;
  promotion: string | null;
  recommendations: string | null;
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

export async function fetchProductFragmentSlots({
  headers,
  fetchImpl,
  timeoutMs = 200,
  cookieHeader = headers?.get("cookie") ?? "",
  productId = "123",
  awaitBackgroundJob = false,
  now,
}: FetchProductFragmentSlotsOptions = {}): Promise<ProductFragmentHtml> {
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

  const execution = await executeFragmentSlots({
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
    slots: [
      {
        name: "staticProof",
        fragment: "static-product-proof",
        strategy: "static",
        staticHtml:
          '<section data-fragment="static-product-proof" data-render-strategy="static"><h2>Static product proof</h2><p>This proof block is safe to prerender as static HTML.</p></section>',
      },
      {
        name: "promotion",
        fragment: "promotion-banner",
        channel: "stable",
        strategy: "isr",
        timeoutMs,
        dataDependencies: ["product-promotion"],
        props: { scene: "product", campaignId: "product-launch" },
        cachePolicy: {
          ttl: 300,
          tags: ["promotion", "product"],
          vary: ["tenant", "locale", "experiment", "props"],
        },
      },
      {
        name: "recommendations",
        fragment: "recommendation-widget",
        channel: "stable",
        strategy: "dynamic-ssr",
        timeoutMs,
        dataDependencies: ["product-price"],
        props: { scene: "product", limit: 3 },
      },
    ],
  });

  const slots = execution.slots;

  // --- Signed cookie storage (recently viewed) ------------------------------
  const recentlyViewed = await trackRecentlyViewed({
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
  let jobStatus = "queued";
  if (awaitBackgroundJob) {
    const result = await job.completion;
    jobStatus = result.status;
  }

  const summaryData = execution.data["product-summary"];
  const summaryValue = (summaryData?.value ?? {}) as { label?: string };

  return {
    staticProof: slots.staticProof.response.html,
    promotion: slots.promotion.response.html,
    recommendations: slots.recommendations.response.html,
    diagnostics: {
      staticProof: {
        source: slots.staticProof.source,
        strategy: slots.staticProof.strategy,
      },
      promotion: {
        source: slots.promotion.source,
        strategy: slots.promotion.strategy,
      },
      recommendations: {
        source: slots.recommendations.source,
        strategy: slots.recommendations.strategy,
      },
    },
    dataDiagnostics: {
      productSummary: {
        // The DAG resolves product-summary exactly once even though two slots
        // depend on data derived from it.
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
    backgroundJobs: {
      taskId: job.taskId,
      status: jobStatus,
      stats: worker.stats(),
    },
    traceLog: trace.toDependencyGraphLog(),
  };
}
