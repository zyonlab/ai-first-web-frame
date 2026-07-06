import { createDataClient, defineDataSource } from "@mvp/data";
import { createRequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import { type FragmentSlotResult, fetchFragmentSlots } from "@mvp/runtime";
import { fragmentRegistry } from "../../../platform/fragment-registry/src/registry";

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
  traceLog: string;
};

type FetchProductFragmentSlotsOptions = {
  headers?: Headers;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export async function fetchProductFragmentSlots({
  headers,
  fetchImpl,
  timeoutMs = 200,
}: FetchProductFragmentSlotsOptions = {}): Promise<ProductFragmentHtml> {
  const ctx = createRequestContext({ headers });
  const trace = createRequestTrace({
    traceId: ctx.traceId,
    requestId: ctx.requestId,
  });
  const productSummary = defineDataSource({
    id: "product-summary",
    dependency: {
      id: "product-summary",
      owner: "page",
      source: "server-function",
      freshness: "isr",
      privacy: "tenant",
      cachePolicy: {
        ttl: 300,
        tags: ["product", "summary"],
        vary: ["tenant", "locale", "props"],
      },
      invalidationTags: ["product:summary"],
      dependsOn: [],
    },
    load: async () => ({
      label: ctx.locale.startsWith("zh") ? "商品摘要" : "Product summary",
    }),
  });
  const dataClient = createDataClient({
    ctx,
    trace,
    sources: [productSummary],
  });
  const [firstProductSummary, secondProductSummary] = await Promise.all([
    dataClient.readData<{ label: string }>("product-summary", {
      route: "product",
    }),
    dataClient.readData<{ label: string }>("product-summary", {
      route: "product",
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
        props: { scene: "product", limit: 3 },
      },
    ],
  });

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
        firstRead: firstProductSummary.source,
        secondRead: secondProductSummary.source,
        label: firstProductSummary.data.label,
      },
    },
    traceLog: trace.toDependencyGraphLog(),
  };
}
