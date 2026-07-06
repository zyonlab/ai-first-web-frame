import {
  createDataClient,
  type DataReadResult,
  defineDataSource,
} from "@mvp/data";
import { createRequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import {
  executeFragmentSlots,
  type FragmentSlotResult,
  type PageHealth,
  type SchedulerHint,
} from "@mvp/runtime";
import { fragmentRegistry } from "../../../platform/fragment-registry/src/registry";

const FEATURED_CONTENT_ID = "home-featured-content";

export type HomeSlotDiagnostic = Pick<
  FragmentSlotResult,
  "source" | "strategy"
> & {
  status: FragmentSlotResult["status"];
  required: boolean;
};

export type HomeFragmentHtml = {
  staticEditorial: string | null;
  promotion: string | null;
  recommendations: string | null;
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

type FetchFragmentSlotsOptions = {
  headers?: Headers;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export async function fetchHomeFragmentSlots({
  headers,
  fetchImpl,
  timeoutMs = 200,
}: FetchFragmentSlotsOptions = {}): Promise<HomeFragmentHtml> {
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
  // exposes it as a single data dependency; both the slot that requires it and
  // the diagnostics panel below read the same deduped result.
  const featuredReads: {
    first: DataReadResult<{ title: string }> | null;
    second: DataReadResult<{ title: string }> | null;
  } = { first: null, second: null };

  const execution = await executeFragmentSlots({
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
    slots: [
      {
        name: "staticEditorial",
        fragment: "static-editorial-note",
        strategy: "static",
        staticHtml:
          '<section data-fragment="static-editorial-note" data-render-strategy="static"><h2>Static SSG sample</h2><p>This editorial block is emitted without a runtime fragment service call.</p></section>',
      },
      {
        name: "promotion",
        fragment: "promotion-banner",
        channel: "stable",
        strategy: "cached-ssr",
        timeoutMs,
        // Required: if the promotion fragment fails the whole page is reported
        // as unhealthy (a required capability is missing), not merely degraded.
        required: true,
        // Depends on the shared featured-content data node, so the scheduler
        // resolves that data once and gates this slot behind it.
        dataDependencies: [FEATURED_CONTENT_ID],
        props: { scene: "home", campaignId: "summer" },
        cachePolicy: {
          ttl: 60,
          tags: ["promotion", "home"],
          vary: ["tenant", "locale", "experiment", "props"],
        },
      },
      {
        name: "recommendations",
        fragment: "recommendation-widget",
        channel: "stable",
        strategy: "dynamic-ssr",
        timeoutMs,
        // Optional: a failure here only degrades the page and renders a
        // fallback; it never marks the page unhealthy.
        required: false,
        props: { scene: "home", limit: 3 },
      },
    ],
  });

  const slots = execution.slots;
  const featuredTitle =
    featuredReads.first?.data.title ??
    (ctx.locale.startsWith("zh") ? "精选内容" : "Featured content");

  return {
    staticEditorial: slots.staticEditorial.response.html,
    promotion: slots.promotion.response.html,
    recommendations: slots.recommendations.response.html,
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
}

function toDiagnostic(result: FragmentSlotResult): HomeSlotDiagnostic {
  return {
    source: result.source,
    strategy: result.strategy,
    status: result.status,
    required: result.slot.required ?? false,
  };
}
