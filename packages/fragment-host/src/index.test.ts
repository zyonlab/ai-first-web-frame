import {
  configureTraceExport,
  type RequestTraceSnapshot,
  resetTraceExport,
} from "@mvp/observability";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFragmentObservability,
  createFragmentServer,
  isProcessEntry,
  renderFragmentServiceHome,
  resetFragmentTraceExportState,
} from "./index";

type DemoRequest = {
  ctx?: { locale?: string; traceId?: string };
  props?: { label?: string };
};

const manifest = {
  name: "demo-fragment",
  version: "1.2.3",
  assets: { js: [], css: ["/assets/demo.css"] },
};
const budget = {
  scope: "fragment",
  name: "demo-fragment",
  maxFragmentLatencyMs: 200,
};

async function renderDemo(
  request: DemoRequest,
  options: {
    trace?: {
      startSpan: (...args: never[]) => string;
      endSpan: (...args: never[]) => void;
    };
  } = {},
) {
  const trace = options.trace as
    | {
        startSpan: (name: string, kind?: string) => string;
        endSpan: (id: string) => void;
      }
    | undefined;
  const span = trace?.startSpan("render:demo-fragment", "fragment");
  if (!request.props) {
    if (span) trace?.endSpan(span);
    return {
      statusCode: 400,
      body: {
        html: '<section data-fragment="demo-fragment" data-fallback="true">no props</section>',
        assets: { js: [], css: [] },
        cache: { ttl: 5, tags: ["demo-fragment"] },
        metadata: { name: "demo-fragment", version: "1.2.3", fallback: true },
      },
    };
  }
  if (span) trace?.endSpan(span);
  return {
    statusCode: 200,
    body: {
      html: `<section data-fragment="demo-fragment">${request.props.label ?? "demo"}</section>`,
      assets: { js: [], css: [] },
      cache: { ttl: 60, tags: ["demo-fragment"] },
      metadata: { name: "demo-fragment", version: "1.2.3" },
    },
  };
}

function buildTestServer(options: { now?: () => number } = {}) {
  return createFragmentServer<DemoRequest>({
    serviceName: "demo-fragment",
    port: 4299,
    manifest,
    budget,
    render: renderDemo,
    demo: { ctx: { locale: "en-US" }, props: { label: "sample-render" } },
    ...options,
  });
}

beforeEach(() => {
  resetFragmentTraceExportState();
});

afterEach(() => {
  resetTraceExport();
});

describe("createFragmentServer", () => {
  it("GET / renders the demo page with the manifest version and a live sample", async () => {
    const response = await buildTestServer().inject({
      method: "GET",
      url: "/",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("demo-fragment fragment");
    expect(response.body).toContain('data-fragment-version="1.2.3"');
    expect(response.body).toContain("sample-render");
    expect(response.body).toContain("POST http://localhost:4299/render");
  });

  it("GET /health and /ready both report service, version and uptime", async () => {
    let clock = 1_000;
    const server = buildTestServer({ now: () => clock });
    clock = 1_750;
    for (const url of ["/health", "/ready"]) {
      const body = (await server.inject({ method: "GET", url })).json();
      expect(body).toMatchObject({
        status: "ok",
        service: "demo-fragment",
        version: "1.2.3",
        uptimeMs: 750,
      });
    }
  });

  it("serves manifest, assets and budget verbatim", async () => {
    const server = buildTestServer();
    expect(
      (await server.inject({ method: "GET", url: "/manifest" })).json(),
    ).toEqual(manifest);
    expect(
      (await server.inject({ method: "GET", url: "/assets" })).json(),
    ).toEqual(manifest.assets);
    expect(
      (await server.inject({ method: "GET", url: "/budget" })).json(),
    ).toEqual(budget);
  });

  it("POST /render validates the envelope and returns the render body", async () => {
    const server = buildTestServer();
    const ok = await server.inject({
      method: "POST",
      url: "/render",
      payload: { ctx: { locale: "en-US" }, props: { label: "hello" } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().html).toContain("hello");

    const degraded = await server.inject({
      method: "POST",
      url: "/render",
      payload: { ctx: {} },
    });
    expect(degraded.statusCode).toBe(400);
    expect(degraded.json().html).toContain("data-fallback");
  });

  it("POST /render rejects a malformed envelope with structured issues", async () => {
    const response = await buildTestServer().inject({
      method: "POST",
      url: "/render",
      payload: { ctx: "not-an-object" },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("invalid-render-request");
    expect(body.error.issues.length).toBeGreaterThan(0);
  });

  it("records HTTP and render metrics but never for probe/scrape routes", async () => {
    const server = buildTestServer();
    await server.inject({
      method: "POST",
      url: "/render",
      payload: { props: { label: "m" } },
    });
    await server.inject({ method: "GET", url: "/health" });
    await server.inject({ method: "GET", url: "/ready" });
    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    expect(metrics.headers["content-type"]).toContain("text/plain");
    expect(metrics.body).toContain("# TYPE http_requests_total counter");
    expect(metrics.body).toContain('route="/render"');
    expect(metrics.body).toContain(
      "# TYPE fragment_render_duration_seconds histogram",
    );
    expect(metrics.body).not.toContain('route="/health"');
    expect(metrics.body).not.toContain('route="/ready"');
    expect(metrics.body).not.toContain('route="/metrics"');
  });

  it("accepts an injected observability surface", async () => {
    const observability = createFragmentObservability();
    const server = buildTestServer();
    const injected = createFragmentServer<DemoRequest>({
      serviceName: "demo-fragment",
      port: 4299,
      manifest,
      budget,
      render: renderDemo,
      demo: { props: { label: "x" } },
      observability,
    });
    await injected.inject({
      method: "POST",
      url: "/render",
      payload: { props: { label: "x" } },
    });
    expect(observability.registry.toPrometheusText()).toContain(
      'route="/render"',
    );
    // The default registry of the other server stayed untouched by that call.
    expect(
      (await server.inject({ method: "GET", url: "/metrics" })).body,
    ).not.toContain('route="/render"');
  });

  it("exports one trace per /render carrying the caller's traceId", async () => {
    const exported: RequestTraceSnapshot[] = [];
    const server = buildTestServer();
    configureTraceExport({
      exporters: [{ export: (snapshot) => void exported.push(snapshot) }],
    });
    await server.inject({
      method: "POST",
      url: "/render",
      payload: { ctx: { traceId: "trace-host-test" }, props: { label: "t" } },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(exported).toHaveLength(1);
    expect(exported[0].traceId).toBe("trace-host-test");
    expect(exported[0].nodes.map((node) => node.name)).toContain(
      "request:/render",
    );
  });

  it("mounts fragment-specific extra routes", async () => {
    const server = createFragmentServer<DemoRequest>({
      serviceName: "demo-fragment",
      port: 4299,
      manifest,
      budget,
      render: renderDemo,
      demo: { props: { label: "x" } },
      extraRoutes: (instance) => {
        instance.get("/assets/demo.island.js", async (_request, reply) => {
          reply.type("text/javascript; charset=utf-8");
          return "export const ok = true;";
        });
      },
    });
    const response = await server.inject({
      method: "GET",
      url: "/assets/demo.island.js",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("export const ok");
  });
});

describe("helpers", () => {
  it("renderFragmentServiceHome stamps the version on the service marker", () => {
    const html = renderFragmentServiceHome({
      title: "x fragment",
      version: "9.9.9",
      port: 1234,
      sampleHtml: "<p>s</p>",
    });
    expect(html).toContain('data-fragment-version="9.9.9"');
    expect(html).toContain("POST http://localhost:1234/render");
  });

  it("isProcessEntry is false for a module that is not argv[1]", () => {
    expect(isProcessEntry("file:///definitely/not/the/entry.js")).toBe(false);
  });
});
