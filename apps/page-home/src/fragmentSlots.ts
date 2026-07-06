import { createDataClient, defineDataSource } from "@mvp/data";
import { createRequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import { type FragmentSlotResult, fetchFragmentSlots } from "@mvp/runtime";
import { fragmentRegistry } from "../../../platform/fragment-registry/src/registry";

export type HomeFragmentHtml = {
  staticEditorial: string | null;
  promotion: string | null;
  recommendations: string | null;
  diagnostics: Record<string, Pick<FragmentSlotResult, "source" | "strategy">>;
  dataDiagnostics: {
    featuredContent: {
      firstRead: string;
      secondRead: string;
      title: string;
    };
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
    id: "home-featured-content",
    dependency: {
      id: "home-featured-content",
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
  const [firstFeaturedContent, secondFeaturedContent] = await Promise.all([
    dataClient.readData<{ title: string }>("home-featured-content", {
      route: "home",
    }),
    dataClient.readData<{ title: string }>("home-featured-content", {
      route: "home",
    }),
  ]);
  const slots = await fetchFragmentSlots({
    registry: fragmentRegistry,
    ctx,
    fetchImpl,
    timeoutMs,
    trace,
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
        props: { scene: "home", limit: 3 },
      },
    ],
  });

  return {
    staticEditorial: slots.staticEditorial.response.html,
    promotion: slots.promotion.response.html,
    recommendations: slots.recommendations.response.html,
    diagnostics: {
      staticEditorial: {
        source: slots.staticEditorial.source,
        strategy: slots.staticEditorial.strategy,
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
      featuredContent: {
        firstRead: firstFeaturedContent.source,
        secondRead: secondFeaturedContent.source,
        title: firstFeaturedContent.data.title,
      },
    },
    traceLog: trace.toDependencyGraphLog(),
  };
}
