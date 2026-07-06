import type {
  FragmentRegistry,
  FragmentRenderRequest,
  FragmentRenderResponse,
  PageManifest,
  RenderStrategy,
  RequestContext,
  RouteManifest,
} from "@mvp/contracts";
import { serializeContext } from "@mvp/request-context";

type RuntimeTrace = {
  startSpan: (
    name: string,
    kind?: "scheduler" | "fragment" | "network" | "cache" | "static" | "custom",
    options?: {
      parentId?: string;
      attributes?: Record<string, unknown>;
    },
  ) => string;
  endSpan: (
    spanId: string,
    options?: {
      status?: "ok" | "error" | "timeout" | "fallback" | "cache" | "static";
      attributes?: Record<string, unknown>;
    },
  ) => void;
  addDependency: (
    from: string,
    to: string,
    type?: "parent" | "depends-on" | "calls" | "uses-cache",
  ) => void;
};

export type FragmentSlotDefinition = {
  name: string;
  fragment: string;
  channel?: string;
  strategy?: RenderStrategy;
  timeoutMs?: number;
  props?: Record<string, unknown>;
  staticHtml?: string;
  cachePolicy?: {
    ttl: number;
    tags?: string[];
    vary?: Array<"tenant" | "locale" | "experiment" | "device" | "props">;
  };
  dependsOn?: string[];
  required?: boolean;
};

export type FragmentSlotResult = {
  slot: FragmentSlotDefinition;
  strategy: RenderStrategy;
  source: "static" | "cache" | "network" | "fallback";
  response: FragmentRenderResponse;
  cacheKey?: string;
};

export type FragmentCache = Map<
  string,
  { expiresAt: number; response: FragmentRenderResponse }
>;

const defaultFragmentCache: FragmentCache = new Map();

export type FragmentSlotExecutionPlan = FragmentSlotDefinition[][];

export function resolveRoute(routeManifest: RouteManifest, pathname: string) {
  return (
    routeManifest.routes.find((route) => {
      if (route.path === pathname) return true;
      const pattern = `^${route.path.replace(/:[^/]+/g, "[^/]+")}$`;
      return new RegExp(pattern).test(pathname);
    }) ?? null
  );
}

export function resolveFragment(
  fragmentRegistry: FragmentRegistry,
  name: string,
  versionOrChannel: string,
): { version: string; serviceUrl: string; manifestUrl: string } | null {
  const entry = fragmentRegistry.fragments[name];
  if (!entry) return null;
  if (
    versionOrChannel === "stable" ||
    versionOrChannel === "canary" ||
    versionOrChannel === "preview"
  )
    return entry[versionOrChannel] ?? null;
  if (entry.versions?.[versionOrChannel])
    return entry.versions[versionOrChannel];
  for (const channel of ["stable", "canary", "preview"] as const) {
    const candidate = entry[channel];
    if (candidate?.version === versionOrChannel) return candidate;
  }
  return null;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createFallbackHtml(fragmentName: string, reason: string) {
  return `<section data-fragment="${fragmentName}" data-fallback="true"><p>${fragmentName} is temporarily unavailable.</p><small>${reason}</small></section>`;
}

export function createFallbackResponse(
  fragmentName: string,
  version = "fallback",
  reason = "fallback",
): FragmentRenderResponse {
  return {
    html: createFallbackHtml(fragmentName, reason),
    assets: { js: [], css: [] },
    cache: { ttl: 5, tags: ["fallback", fragmentName] },
    metadata: { name: fragmentName, version },
  };
}

export function createFragmentHeaders(
  ctx: RequestContext,
): Record<string, string> {
  return {
    "content-type": "application/json",
    ...serializeContext(ctx),
  };
}

export async function fetchFragment(
  fragment: { serviceUrl: string; version: string },
  request: FragmentRenderRequest,
  options: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    trace?: RuntimeTrace;
    parentSpanId?: string;
    spanName?: string;
  } = {},
): Promise<FragmentRenderResponse> {
  const fallback = createFallbackResponse(
    fragment.serviceUrl,
    fragment.version,
    "fallback",
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const spanId = options.trace?.startSpan(
    options.spanName ?? `fragment.http:${fragment.serviceUrl}`,
    "network",
    {
      parentId: options.parentSpanId,
      attributes: {
        serviceUrl: fragment.serviceUrl,
        version: fragment.version,
        timeoutMs: options.timeoutMs ?? 200,
      },
    },
  );
  try {
    const response = await withTimeout(
      fetchImpl(`${fragment.serviceUrl}/render`, {
        method: "POST",
        headers: createFragmentHeaders(request.ctx),
        body: JSON.stringify(request),
      })
        .then(async (response) => {
          if (!response.ok)
            throw new Error(`fragment status ${response.status}`);
          return (await response.json()) as FragmentRenderResponse;
        })
        .catch(() => fallback),
      options.timeoutMs ?? 200,
      fallback,
    );
    options.trace?.endSpan(spanId ?? "", {
      status: response.html.includes('data-fallback="true"')
        ? "fallback"
        : "ok",
      attributes: { fallback: response.html.includes('data-fallback="true"') },
    });
    return response;
  } catch (error) {
    options.trace?.endSpan(spanId ?? "", {
      status: "error",
      attributes: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

export async function fetchFragmentSlots({
  slots,
  registry,
  ctx,
  fetchImpl,
  timeoutMs = 200,
  cache = defaultFragmentCache,
  now = Date.now,
  trace,
}: {
  slots: FragmentSlotDefinition[];
  registry: FragmentRegistry;
  ctx: RequestContext;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  cache?: FragmentCache;
  now?: () => number;
  trace?: RuntimeTrace;
}): Promise<Record<string, FragmentSlotResult>> {
  const executionPlan = createFragmentSlotExecutionPlan(slots);
  const schedulerSpanId = trace?.startSpan(
    "runtime.fetchFragmentSlots",
    "scheduler",
    {
      attributes: {
        slotCount: slots.length,
        slots: slots.map((slot) => slot.name),
        levels: executionPlan.map((level) => level.map((slot) => slot.name)),
      },
    },
  );

  const result: Record<string, FragmentSlotResult> = {};
  for (const level of executionPlan) {
    const settled = await Promise.allSettled(
      level.map((slot) =>
        fetchFragmentSlot({
          slot,
          registry,
          ctx,
          fetchImpl,
          timeoutMs,
          cache,
          now,
          trace,
          parentSpanId: schedulerSpanId,
        }),
      ),
    );
    for (const [index, settledResult] of settled.entries()) {
      const slot = level[index];
      if (settledResult.status === "fulfilled") {
        result[slot.name] = settledResult.value;
      } else {
        result[slot.name] = {
          slot,
          strategy: slot.strategy ?? "dynamic-ssr",
          source: "fallback",
          response: createFallbackResponse(slot.fragment, "fallback", "error"),
        };
      }
    }
  }

  trace?.endSpan(schedulerSpanId ?? "", { status: "ok" });
  return result;
}

export function createFragmentSlotExecutionPlan(
  slots: FragmentSlotDefinition[],
): FragmentSlotExecutionPlan {
  const byName = new Map<string, FragmentSlotDefinition>();
  for (const slot of slots) {
    if (byName.has(slot.name))
      throw new Error(`duplicate fragment slot "${slot.name}"`);
    byName.set(slot.name, slot);
  }

  for (const slot of slots) {
    for (const dependency of slot.dependsOn ?? []) {
      if (!byName.has(dependency))
        throw new Error(
          `fragment slot "${slot.name}" depends on missing slot "${dependency}"`,
        );
    }
  }

  const remaining = new Set(slots.map((slot) => slot.name));
  const completed = new Set<string>();
  const levels: FragmentSlotExecutionPlan = [];

  while (remaining.size > 0) {
    const ready = slots.filter(
      (slot) =>
        remaining.has(slot.name) &&
        (slot.dependsOn ?? []).every((dependency) => completed.has(dependency)),
    );
    if (ready.length === 0) {
      throw new Error(
        `fragment slot dependency cycle detected: ${[...remaining].join(", ")}`,
      );
    }
    levels.push(ready);
    for (const slot of ready) {
      remaining.delete(slot.name);
      completed.add(slot.name);
    }
  }

  return levels;
}

export async function fetchFragmentSlot({
  slot,
  registry,
  ctx,
  fetchImpl,
  timeoutMs,
  cache,
  now,
  trace,
  parentSpanId,
}: {
  slot: FragmentSlotDefinition;
  registry: FragmentRegistry;
  ctx: RequestContext;
  fetchImpl?: typeof fetch;
  timeoutMs: number;
  cache: FragmentCache;
  now: () => number;
  trace?: RuntimeTrace;
  parentSpanId?: string;
}): Promise<FragmentSlotResult> {
  const strategy = slot.strategy ?? "dynamic-ssr";
  const slotSpanId = trace?.startSpan(`slot:${slot.name}`, "fragment", {
    parentId: parentSpanId,
    attributes: {
      slot: slot.name,
      fragment: slot.fragment,
      strategy,
      channel: slot.channel ?? "stable",
      dependsOn: slot.dependsOn ?? [],
    },
  });
  for (const dependency of slot.dependsOn ?? []) {
    if (slotSpanId)
      trace?.addDependency(`slot:${dependency}`, slotSpanId, "depends-on");
  }
  try {
    if (strategy === "static") {
      const result: FragmentSlotResult = {
        slot,
        strategy,
        source: "static",
        response: {
          html:
            slot.staticHtml ??
            createFallbackHtml(slot.fragment, "missing static html"),
          assets: { js: [], css: [] },
          cache: {
            ttl: slot.cachePolicy?.ttl ?? 31_536_000,
            tags: slot.cachePolicy?.tags ?? [slot.fragment, "static"],
          },
          metadata: { name: slot.fragment, version: "static" },
        },
      };
      trace?.endSpan(slotSpanId ?? "", { status: "static" });
      return result;
    }

    const fragment = resolveFragment(
      registry,
      slot.fragment,
      slot.channel ?? "stable",
    );
    if (!fragment) {
      const result: FragmentSlotResult = {
        slot,
        strategy,
        source: "fallback",
        response: createFallbackResponse(
          slot.fragment,
          "missing",
          "not registered",
        ),
      };
      trace?.endSpan(slotSpanId ?? "", {
        status: "fallback",
        attributes: { reason: "not registered" },
      });
      return result;
    }

    const request: FragmentRenderRequest = { ctx, props: slot.props ?? {} };
    const cacheable = strategy === "cached-ssr" || strategy === "isr";
    const cacheKey = cacheable
      ? createFragmentCacheKey(slot, fragment, request)
      : undefined;
    if (cacheKey) {
      const entry = cache.get(cacheKey);
      if (entry && entry.expiresAt > now()) {
        const cacheSpanId = trace?.startSpan(`cache:${slot.name}`, "cache", {
          parentId: slotSpanId,
          attributes: { cacheKey },
        });
        if (slotSpanId && cacheSpanId)
          trace?.addDependency(slotSpanId, cacheSpanId, "uses-cache");
        trace?.endSpan(cacheSpanId ?? "", { status: "cache" });
        const result: FragmentSlotResult = {
          slot,
          strategy,
          source: "cache",
          response: entry.response,
          cacheKey,
        };
        trace?.endSpan(slotSpanId ?? "", {
          status: "cache",
          attributes: { cacheKey },
        });
        return result;
      }
    }

    const response = await fetchFragment(fragment, request, {
      fetchImpl,
      timeoutMs: slot.timeoutMs ?? timeoutMs,
      trace,
      parentSpanId: slotSpanId,
      spanName: `fragment.http:${slot.name}`,
    });

    if (cacheKey && !response.html.includes('data-fallback="true"')) {
      const ttl = slot.cachePolicy?.ttl ?? response.cache.ttl;
      if (ttl > 0)
        cache.set(cacheKey, { expiresAt: now() + ttl * 1000, response });
    }

    const result: FragmentSlotResult = {
      slot,
      strategy,
      source: response.html.includes('data-fallback="true"')
        ? "fallback"
        : "network",
      response,
      cacheKey,
    };
    trace?.endSpan(slotSpanId ?? "", {
      status: result.source === "fallback" ? "fallback" : "ok",
      attributes: { source: result.source, cacheKey },
    });
    return result;
  } catch (error) {
    trace?.endSpan(slotSpanId ?? "", {
      status: "error",
      attributes: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

export function createFragmentCacheKey(
  slot: FragmentSlotDefinition,
  fragment: { version: string; serviceUrl: string },
  request: FragmentRenderRequest,
): string {
  const vary = slot.cachePolicy?.vary ?? [
    "tenant",
    "locale",
    "experiment",
    "props",
  ];
  const parts: Record<string, unknown> = {
    fragment: slot.fragment,
    version: fragment.version,
    strategy: slot.strategy ?? "dynamic-ssr",
  };
  if (vary.includes("tenant")) parts.tenant = request.ctx.tenant;
  if (vary.includes("locale")) parts.locale = request.ctx.locale;
  if (vary.includes("experiment")) parts.experiment = request.ctx.experiment;
  if (vary.includes("device")) parts.device = request.ctx.device;
  if (vary.includes("props")) parts.props = request.props;
  return stableStringify(parts);
}

export function clearFragmentCache(
  cache: FragmentCache = defaultFragmentCache,
) {
  cache.clear();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function composePage(
  pageManifest: PageManifest,
  slots: Record<string, FragmentRenderResponse | Error>,
  ctx: RequestContext,
) {
  const fragments = pageManifest.slots
    .map((slot) => {
      const response = slots[slot.name];
      if (!response || response instanceof Error)
        return createFallbackHtml(
          slot.fragment,
          response?.message ?? "missing",
        );
      return response.html;
    })
    .join("");
  return [
    "<!doctype html>",
    `<html lang="${ctx.locale}"><head><title>${pageManifest.seo.title}</title><meta name="description" content="${pageManifest.seo.description}"></head>`,
    `<body><main><h1>${pageManifest.seo.title}</h1><p>${pageManifest.seo.description}</p>${fragments}</main></body></html>`,
  ].join("");
}

export function mergeAssets(fragmentResponses: FragmentRenderResponse[]) {
  return {
    js: [
      ...new Set(fragmentResponses.flatMap((response) => response.assets.js)),
    ],
    css: [
      ...new Set(fragmentResponses.flatMap((response) => response.assets.css)),
    ],
  };
}
