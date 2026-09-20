/**
 * Fragment scaffold templates.
 *
 * These produce a fragment that RUNS. The previous templates emitted a
 * `server.ts` that was a two-line re-export (no Fastify, no `/render`) and a
 * three-line Dockerfile with no COPY/install/build — while the lifecycle's
 * step-1 acceptance (`"status": "created"`, 9 files) passed, so an agent got a
 * success signal for a service that could neither answer `/render` nor build an
 * image. Every template below is the same shape the 14 live fragments use, on
 * top of `@mvp/fragment-host`.
 */

export type FragmentTemplateInput = {
  /** PascalCase component name, e.g. `PricePanel`. */
  name: string;
  /** kebab-case fragment/service name, e.g. `price-panel`. */
  kebab: string;
  /** camelCase identifier prefix, e.g. `pricePanel`. */
  camel: string;
  /** Port the service listens on by default. */
  port: number;
};

export function fragmentServer({
  name,
  kebab,
  camel,
  port,
}: FragmentTemplateInput): string {
  return `/**
 * ${kebab} SSR fragment service.
 *
 * Every HTTP behavior — \`GET /\` demo page, \`/health\`, \`/ready\`, \`/metrics\`,
 * \`/manifest\`, \`/assets\`, \`/budget\`, \`POST /render\` envelope validation,
 * request metrics and trace export — lives in \`@mvp/fragment-host\`. This file
 * only names the fragment and hands the host its manifest, budget, render
 * function and demo request.
 */

import {
  type BuildFragmentServerOptions,
  createFragmentServer,
  isProcessEntry,
  startFragmentServer,
} from "@mvp/fragment-host";
import { ${camel}Budget } from "./budget";
import { ${camel}Manifest } from "./manifest";
import { render${name} } from "./render";

export const SERVICE_NAME = "${kebab}";
const DEFAULT_PORT = ${port};

export function buildServer(options: BuildFragmentServerOptions = {}) {
  return createFragmentServer({
    serviceName: SERVICE_NAME,
    port: DEFAULT_PORT,
    manifest: ${camel}Manifest,
    budget: ${camel}Budget,
    render: render${name},
    demo: { ctx: { locale: "en-US" }, props: { title: "${name}" } },
    ...options,
  });
}

if (isProcessEntry(import.meta.url)) {
  await startFragmentServer(buildServer(), {
    serviceName: SERVICE_NAME,
    port: DEFAULT_PORT,
  });
}
`;
}

export function fragmentRender({
  name,
  kebab,
  camel,
}: FragmentTemplateInput): string {
  return `import type { FragmentRenderResponse, RequestContext } from "@mvp/contracts";
import type { RequestTrace } from "@mvp/observability";
import { createRequestContext } from "@mvp/request-context";
import { ${camel}Manifest } from "./manifest";

export type ${name}RenderRequest = {
  ctx?: { locale?: string; tenant?: string; traceId?: string };
  props?: { title?: string };
};

export type ${name}RenderOptions = {
  /** Active request trace; a render span is recorded when provided. */
  trace?: RequestTrace;
};

function toRequestContext(
  ctx: ${name}RenderRequest["ctx"],
): RequestContext {
  return createRequestContext({
    headers: {
      "x-locale": ctx?.locale ?? "en-US",
      "x-tenant": ctx?.tenant ?? "default",
      ...(ctx?.traceId ? { "x-trace-id": ctx.traceId } : {}),
    },
  });
}

/** Degraded output. \`metadata.fallback\` is what the runtime reads (never an HTML sniff). */
export function create${name}Fallback(reason: string): FragmentRenderResponse {
  return {
    html: \`<section data-fragment="${kebab}" data-fallback="true"><p>${kebab} is temporarily unavailable.</p></section>\`,
    assets: { js: [], css: [] },
    cache: { ttl: 5, tags: ["fallback", "${kebab}"] },
    metadata: {
      name: ${camel}Manifest.name,
      version: ${camel}Manifest.version,
      fallback: true,
      reason,
    },
  };
}

export function render${name}Html(title: string): string {
  return \`<section data-fragment="${kebab}"><h2 data-field="title">\${title}</h2></section>\`;
}

/**
 * The fragment's render entry point. Returns the \`{ statusCode, body }\` pair
 * \`@mvp/fragment-host\` expects: a 200 with a \`FragmentRenderResponse\`, or a
 * 4xx/5xx with the degraded response above.
 */
export async function render${name}(
  request: ${name}RenderRequest,
  options: ${name}RenderOptions = {},
): Promise<{ statusCode: number; body: FragmentRenderResponse }> {
  const { trace } = options;
  const renderSpan = trace?.startSpan("render:${kebab}", "fragment", {
    attributes: { fragment: ${camel}Manifest.name },
  });

  if (!request.props?.title) {
    trace?.endSpan(renderSpan ?? "", {
      status: "fallback",
      attributes: { reason: "missing props", propsValid: false },
    });
    return { statusCode: 400, body: create${name}Fallback("missing props") };
  }

  const ctx = toRequestContext(request.ctx);
  const html = render${name}Html(request.props.title);
  trace?.endSpan(renderSpan ?? "", { status: "ok" });

  return {
    statusCode: 200,
    body: {
      html,
      assets: ${camel}Manifest.assets,
      cache: { ttl: 60, tags: ["${kebab}"], vary: ["locale"] },
      metadata: {
        name: ${camel}Manifest.name,
        version: ${camel}Manifest.version,
        locale: ctx.locale,
      },
    },
  };
}
`;
}

export function fragmentManifest({
  name,
  kebab,
  camel,
}: FragmentTemplateInput): string {
  return `import { type FragmentManifest, loadDefaultBudget } from "@mvp/contracts";

// \`satisfies FragmentManifest\` gives compile-time checking against the
// contract schema; \`layoutHint\` is a repo convention outside the schema, so
// the intersection keeps excess-property checking happy.
export const ${camel}Manifest = {
  name: "${kebab}",
  version: "0.1.0",
  owner: "generated",
  renderMode: "ssr",
  renderStrategy: "dynamic-ssr",
  fallback: '<section data-fragment="${kebab}" data-fallback="true">${name}</section>',
  assets: { js: [], css: [] },
  // Browser-reachable backend endpoints for this fragment's island, mounted by
  // the shell gateway at /_fragment/${kebab}/<target>/*. A root-relative value
  // resolves against this fragment's own registry serviceUrl (correct in every
  // environment); an absolute http(s) URL points at a shared backend. Leave
  // empty until an island actually needs to fetch after hydration.
  proxy: {},
  // Adjust shape/minHeight/fills to this fragment's real rendered geometry
  // (shape: "bar" | "ladder" | "table" | "chart" | "panel"; see LayoutHint in tools/release-tools/src/unit-graph.ts).
  layoutHint: { shape: "panel", minHeight: 120, fills: false },
  budget: loadDefaultBudget("fragment", "${kebab}"),
} satisfies FragmentManifest & { layoutHint: Record<string, unknown> };
`;
}

export function fragmentBudget({
  kebab,
  camel,
}: FragmentTemplateInput): string {
  return `import { loadDefaultBudget } from "@mvp/contracts";

/**
 * Hard gate: \`pnpm audit:bundle\` and \`pnpm audit:css\` measure this unit
 * against these ceilings. Replace the defaults with measured values once the
 * fragment has real content.
 */
export const ${camel}Budget = loadDefaultBudget("fragment", "${kebab}");
`;
}

export function fragmentFixtures({
  name,
  camel,
}: FragmentTemplateInput): string {
  return `import type { ${name}RenderRequest } from "./render";

/**
 * Request fixtures. \`ctx\` carries real values because the host validates every
 * \`/render\` body against \`FragmentRenderRequestSchema\` — an empty \`{}\` ctx is
 * rejected by the strict pass.
 */
export const ${camel}Fixtures = {
  basic: {
    ctx: { locale: "en-US", tenant: "default" },
    props: { title: "${name}" },
  },
  degraded: { ctx: { locale: "en-US", tenant: "default" }, props: {} },
} satisfies Record<string, ${name}RenderRequest>;
`;
}

export function fragmentRenderTest({
  name,
  kebab,
  camel,
}: FragmentTemplateInput): string {
  return `import { describe, expect, it } from "vitest";
import { ${camel}Fixtures } from "./fixtures";
import { render${name} } from "./render";

describe("${kebab} render", () => {
  it("renders the fragment root with its props", async () => {
    const result = await render${name}(${camel}Fixtures.basic);
    expect(result.statusCode).toBe(200);
    expect(result.body.html).toContain('data-fragment="${kebab}"');
    expect(result.body.html).toContain("${name}");
    expect(result.body.metadata.fallback).toBeUndefined();
  });

  it("degrades to a stamped fallback when props are missing", async () => {
    const result = await render${name}(${camel}Fixtures.degraded);
    expect(result.statusCode).toBe(400);
    expect(result.body.metadata.fallback).toBe(true);
    expect(result.body.html).toContain('data-fallback="true"');
  });
});
`;
}

export function fragmentServerTest({
  kebab,
  camel,
}: FragmentTemplateInput): string {
  return `import { describe, expect, it } from "vitest";
import { ${camel}Fixtures } from "../src/fixtures";
import { buildServer } from "../src/server";

describe("${kebab} fragment service", () => {
  it("/health reports the deployed version", async () => {
    const response = await buildServer().inject({
      method: "GET",
      url: "/health",
    });
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "${kebab}",
      version: "0.1.0",
    });
  });

  it("POST /render returns the rendered fragment", async () => {
    const response = await buildServer().inject({
      method: "POST",
      url: "/render",
      payload: ${camel}Fixtures.basic,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().html).toContain('data-fragment="${kebab}"');
  });
});
`;
}

export function fragmentPackageJson({ kebab }: FragmentTemplateInput): string {
  return `${JSON.stringify(
    {
      name: `@mvp/fragment-${kebab}`,
      version: "0.1.0",
      type: "module",
      private: true,
      scripts: {
        dev: "tsx src/server.ts",
        start: "node dist/server.js",
        build: "tsdown src/server.ts --format esm --platform node --dts",
        test: `pnpm -w exec vitest run fragments/${kebab}/tests fragments/${kebab}/src`,
        "test:watch": `pnpm -w exec vitest fragments/${kebab}/tests fragments/${kebab}/src`,
        typecheck: "pnpm exec tsgo -p tsconfig.json --noEmit",
      },
      dependencies: {
        "@mvp/contracts": "workspace:*",
        "@mvp/fragment-host": "workspace:*",
        "@mvp/observability": "workspace:*",
        "@mvp/request-context": "workspace:*",
        fastify: "^4.28.1",
      },
      devDependencies: { tsdown: "^0.11.0" },
    },
    null,
    2,
  )}\n`;
}

export function fragmentTsconfig(): string {
  return `${JSON.stringify(
    {
      extends: "../../tsconfig.base.json",
      compilerOptions: { noEmit: true, types: ["node", "vitest/globals"] },
      include: ["src/**/*.ts", "tests/**/*.ts"],
    },
    null,
    2,
  )}\n`;
}

export function fragmentDockerfile({
  kebab,
  port,
}: FragmentTemplateInput): string {
  return `FROM node:22-alpine
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mvp/fragment-${kebab}... build
ENV NODE_ENV=production
EXPOSE ${port}
CMD ["pnpm", "--filter", "@mvp/fragment-${kebab}", "start"]
`;
}

export function fragmentReadme({
  name,
  kebab,
  port,
}: FragmentTemplateInput): string {
  return `# ${name}

Independently deployable SSR fragment service (\`@mvp/fragment-${kebab}\`),
generated by \`@mvp/create-component\` and hosted by \`@mvp/fragment-host\`.

## Run it alone

\`\`\`txt
pnpm --filter @mvp/fragment-${kebab} test     # unit + service tests
pnpm --filter @mvp/fragment-${kebab} dev      # tsx, port ${port}
pnpm --filter @mvp/fragment-${kebab}... build # tsdown -> dist/server.js
pnpm --filter @mvp/fragment-${kebab} start    # node dist/server.js
\`\`\`

## Endpoints

\`GET /\` (demo) · \`/health\` · \`/ready\` · \`/metrics\` · \`/manifest\` ·
\`/assets\` · \`/budget\` · \`POST /render\`.

\`/health\` and \`/ready\` return the manifest \`version\`, so a deployment system
can confirm which build is live before promoting it.

## Ship it

\`\`\`txt
pnpm exec tsx scripts/register-fragment.mts --name ${kebab} --version 0.1.0 \\
  --service-url http://localhost:${port} --channel canary --with-compose
pnpm exec tsx scripts/mount-slot.mts --page <page> --slot <slot> --fragment ${kebab}
pnpm exec tsx scripts/promote-fragment.mts --name ${kebab}
\`\`\`

See \`docs/OPERATIONS.md\` for the full lifecycle and every JSON envelope.
`;
}
