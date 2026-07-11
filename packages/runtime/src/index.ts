import {
  type FragmentRegistry,
  type FragmentRenderRequest,
  type FragmentRenderResponse,
  normalizeRenderStrategy,
  type PageManifest,
  parseFragmentRenderResponse,
  type ReleaseChannel,
  type RenderStrategy,
  type RequestContext,
  type RouteManifest,
} from "@mvp/contracts";
import { serializeContext } from "@mvp/request-context";

export type { FragmentRenderResponse, ReleaseChannel } from "@mvp/contracts";

/** The strategy used when a slot does not declare one. */
export const DEFAULT_RENDER_STRATEGY: RenderStrategy = "dynamic-ssr";

export type RuntimeTrace = {
  startSpan: (
    name: string,
    kind?:
      | "scheduler"
      | "fragment"
      | "network"
      | "cache"
      | "static"
      | "data"
      | "custom",
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
  channel?: ReleaseChannel;
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
  dataDependencies?: string[];
  required?: boolean;
};

export type FragmentSlotStatus = "ok" | "fallback" | "skipped-dependency";

export type FragmentSlotResult = {
  slot: FragmentSlotDefinition;
  strategy: RenderStrategy;
  source: "static" | "cache" | "network" | "fallback";
  status: FragmentSlotStatus;
  response: FragmentRenderResponse;
  cacheKey?: string;
};

export type DataDependencyDefinition = {
  id: string;
  dependsOn?: string[];
};

export type ScheduledNode =
  | { type: "slot"; key: string; slot: FragmentSlotDefinition }
  | { type: "data"; key: string; id: string; dependsOn: string[] };

export type SchedulerHintKind =
  | "long-serial-chain"
  | "unnecessary-barrier"
  | "duplicate-data-resolution";

export type SchedulerHint = {
  kind: SchedulerHintKind;
  slots: string[];
  data: string[];
  message: string;
};

export type SlotDataExecutionPlan = {
  levels: ScheduledNode[][];
  hints: SchedulerHint[];
};

export type PageHealth = "ok" | "degraded" | "unhealthy";

export type DataResolutionResult = {
  id: string;
  status: "ok" | "error" | "skipped-dependency";
  value?: unknown;
  error?: string;
};

export type FragmentSlotsExecution = {
  slots: Record<string, FragmentSlotResult>;
  data: Record<string, DataResolutionResult>;
  health: PageHealth;
  hints: SchedulerHint[];
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
    metadata: { name: fragmentName, version, fallback: true },
  };
}

/**
 * A render response is a fallback when its contract metadata says so.
 * The HTML sniff is deprecated and only kept until every fragment stamps
 * metadata.fallback on its own degraded path.
 */
export function isFallbackResponse(response: FragmentRenderResponse): boolean {
  if (response.metadata.fallback === true) return true;
  // Deprecated: legacy HTML marker sniff; remove once all fragments set
  // metadata.fallback = true in their degraded responses.
  return response.html.includes('data-fallback="true"');
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
  // Set when the fragment degraded because of an error (bad status, invalid
  // JSON, schema violation) as opposed to a plain timeout — surfaced on the
  // trace span so the fallback is never a silent one (goal A2).
  let degradeReason: string | undefined;
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
          const parsed = parseFragmentRenderResponse(await response.json());
          if (!parsed.ok) {
            const detail = parsed.issues
              .map(
                (issue) =>
                  `${issue.path.join(".") || "(root)"}: ${issue.message}`,
              )
              .join("; ");
            const message = `fragment response failed FragmentRenderResponseSchema (${fragment.serviceUrl}): ${detail}`;
            // A schema violation is a contract bug in the fragment, not a
            // normal degradation like a timeout — always say so out loud.
            console.warn(`[runtime] ${message}`);
            throw new Error(message);
          }
          return parsed.response;
        })
        .catch((error: unknown) => {
          degradeReason =
            error instanceof Error ? error.message : String(error);
          return fallback;
        }),
      options.timeoutMs ?? 200,
      fallback,
    );
    options.trace?.endSpan(spanId ?? "", {
      status: isFallbackResponse(response) ? "fallback" : "ok",
      attributes: {
        fallback: isFallbackResponse(response),
        ...(degradeReason ? { error: degradeReason } : {}),
      },
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

export type FetchFragmentSlotsOptions = {
  slots: FragmentSlotDefinition[];
  registry: FragmentRegistry;
  ctx: RequestContext;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  cache?: FragmentCache;
  now?: () => number;
  trace?: RuntimeTrace;
  dataDependencies?: DataDependencyDefinition[];
  resolveData?: (id: string) => Promise<unknown> | unknown;
  dataTimeoutMs?: number;
  onRequiredFailure?: "fallback" | "throw";
  maxSerialLevels?: number;
};

export async function fetchFragmentSlots(
  options: FetchFragmentSlotsOptions,
): Promise<Record<string, FragmentSlotResult>> {
  const execution = await executeFragmentSlots(options);
  return execution.slots;
}

const DATA_TIMEOUT = Symbol("data-timeout");

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export type FragmentSlotStreamHandle = {
  /**
   * One promise per declared slot (keyed by slot name), each resolving to
   * that slot's `FragmentRenderResponse` the moment ITS OWN DAG level
   * finishes — independent of slots scheduled in later levels and
   * independent of `result` below. Always resolves, never rejects: a failed
   * or skipped slot resolves to the same fallback `FragmentRenderResponse`
   * `executeFragmentSlots` has always produced, so a consumer never needs an
   * error boundary just to render a slot. Feed one of these directly to
   * `<FragmentSlotStream>` (`@mvp/runtime/react`) inside a `<Suspense>`
   * boundary to stream that slot's HTML in as soon as it's ready.
   */
  slots: Record<string, Promise<FragmentRenderResponse>>;
  /**
   * The full aggregate — byte-identical in shape to what
   * `executeFragmentSlots` returns — settling only once every level
   * (including the slowest slot and every data dependency) is done. Feed
   * this to a section that inherently needs the whole picture (page health,
   * scheduler hints, per-slot diagnostics, the request trace log).
   */
  result: Promise<FragmentSlotsExecution>;
};

/**
 * Kicks off the same DAG-aware scheduling `executeFragmentSlots` performs
 * (§4.4 of the refactor plan) but returns IMMEDIATELY — before level 0 has
 * even started — exposing a promise per slot plus one aggregate promise, so
 * a caller (e.g. a Next.js page composing several `<Suspense>` boundaries)
 * can start awaiting/rendering each slot independently instead of blocking
 * on one barrier for the whole page.
 *
 * This owns the one scheduling implementation: `executeFragmentSlots` below
 * is now built on top of it (just awaits `result`), so the two stay
 * behaviorally identical by construction rather than by two copies of the
 * same loop drifting apart.
 */
export function streamFragmentSlots({
  slots,
  registry,
  ctx,
  fetchImpl,
  timeoutMs = 200,
  cache = defaultFragmentCache,
  now = Date.now,
  trace,
  dataDependencies = [],
  resolveData,
  dataTimeoutMs,
  onRequiredFailure = "fallback",
  maxSerialLevels,
}: FetchFragmentSlotsOptions): FragmentSlotStreamHandle {
  const { levels, hints } = createSlotDataExecutionPlan({
    slots,
    dataDependencies,
    maxSerialLevels,
  });
  const schedulerSpanId = trace?.startSpan(
    "runtime.fetchFragmentSlots",
    "scheduler",
    {
      attributes: {
        slotCount: slots.length,
        slots: slots.map((slot) => slot.name),
        levels: levels.map((level) => level.map((node) => node.key)),
        schedulerHints: hints,
      },
    },
  );

  const slotResults: Record<string, FragmentSlotResult> = {};
  const dataResults: Record<string, DataResolutionResult> = {};
  const propagatedFailures = new Set<string>();
  const failedRequiredSlots: string[] = [];
  let degraded = false;

  // One deferred promise per declared slot, created eagerly — before the
  // scheduler runs a single level — so the caller receives every slot's
  // promise up front and can start awaiting/rendering it right away. This is
  // the mechanism that lets a Suspense boundary stream ahead of siblings:
  // `settleSlot` resolves the matching deferred the instant that slot's own
  // node finishes, not when the whole `levels` loop below completes.
  const slotDeferreds = new Map<
    string,
    ReturnType<typeof createDeferred<FragmentRenderResponse>>
  >();
  for (const slot of slots)
    slotDeferreds.set(slot.name, createDeferred<FragmentRenderResponse>());

  function settleSlot(name: string, result: FragmentSlotResult) {
    slotResults[name] = result;
    slotDeferreds.get(name)?.resolve(result.response);
  }

  function recordSlotFailure(slot: FragmentSlotDefinition) {
    degraded = true;
    if (slot.required) {
      failedRequiredSlots.push(slot.name);
      propagatedFailures.add(`slot:${slot.name}`);
    }
  }

  async function runDataNode(node: ScheduledNode & { type: "data" }) {
    const spanId = trace?.startSpan(`data:${node.id}`, "data", {
      parentId: schedulerSpanId,
      attributes: { data: node.id, dependsOn: node.dependsOn },
    });
    for (const dependency of node.dependsOn) {
      if (spanId)
        trace?.addDependency(`data:${dependency}`, spanId, "depends-on");
    }
    try {
      if (!resolveData)
        throw new Error(
          `no resolveData resolver configured for data dependency "${node.id}"`,
        );
      const value = await withTimeout<unknown>(
        Promise.resolve(resolveData(node.id)),
        dataTimeoutMs ?? timeoutMs,
        DATA_TIMEOUT,
      );
      if (value === DATA_TIMEOUT)
        throw new Error(`data dependency "${node.id}" timed out`);
      dataResults[node.id] = { id: node.id, status: "ok", value };
      trace?.endSpan(spanId ?? "", { status: "ok" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dataResults[node.id] = { id: node.id, status: "error", error: message };
      propagatedFailures.add(node.key);
      degraded = true;
      trace?.endSpan(spanId ?? "", {
        status: "error",
        attributes: { error: message },
      });
    }
  }

  async function runSlotNode(node: ScheduledNode & { type: "slot" }) {
    const slot = node.slot;
    try {
      const result = await fetchFragmentSlot({
        slot,
        registry,
        ctx,
        fetchImpl,
        timeoutMs,
        cache,
        now,
        trace,
        parentSpanId: schedulerSpanId,
      });
      settleSlot(slot.name, result);
      if (result.status !== "ok") recordSlotFailure(slot);
    } catch {
      settleSlot(slot.name, {
        slot,
        strategy: slot.strategy ?? DEFAULT_RENDER_STRATEGY,
        source: "fallback",
        status: "fallback",
        response: createFallbackResponse(slot.fragment, "fallback", "error"),
      });
      recordSlotFailure(slot);
    }
  }

  function skipNode(node: ScheduledNode, blockedBy: string[]) {
    degraded = true;
    if (node.type === "data") {
      dataResults[node.id] = {
        id: node.id,
        status: "skipped-dependency",
        error: `skipped: dependency failed (${blockedBy.join(", ")})`,
      };
      propagatedFailures.add(node.key);
      const spanId = trace?.startSpan(`data:${node.id}`, "data", {
        parentId: schedulerSpanId,
        attributes: { data: node.id, reason: "skipped-dependency", blockedBy },
      });
      trace?.endSpan(spanId ?? "", { status: "fallback" });
      return;
    }
    const slot = node.slot;
    settleSlot(slot.name, {
      slot,
      strategy: slot.strategy ?? DEFAULT_RENDER_STRATEGY,
      source: "fallback",
      status: "skipped-dependency",
      response: createFallbackResponse(
        slot.fragment,
        "fallback",
        "skipped-dependency",
      ),
    });
    const spanId = trace?.startSpan(`slot:${slot.name}`, "fragment", {
      parentId: schedulerSpanId,
      attributes: {
        slot: slot.name,
        fragment: slot.fragment,
        reason: "skipped-dependency",
        blockedBy,
      },
    });
    trace?.endSpan(spanId ?? "", { status: "fallback" });
    if (slot.required) {
      failedRequiredSlots.push(slot.name);
      propagatedFailures.add(node.key);
    }
  }

  const result = (async (): Promise<FragmentSlotsExecution> => {
    for (const level of levels) {
      const runnable: ScheduledNode[] = [];
      for (const node of level) {
        const blockedBy = directDependencyKeys(node).filter((dependency) =>
          propagatedFailures.has(dependency),
        );
        if (blockedBy.length > 0) skipNode(node, blockedBy);
        else runnable.push(node);
      }
      await Promise.all(
        runnable.map((node) =>
          node.type === "data" ? runDataNode(node) : runSlotNode(node),
        ),
      );
    }

    const health: PageHealth =
      failedRequiredSlots.length > 0
        ? "unhealthy"
        : degraded
          ? "degraded"
          : "ok";
    trace?.endSpan(schedulerSpanId ?? "", {
      status: health === "unhealthy" ? "fallback" : "ok",
      attributes: { health, failedRequiredSlots },
    });
    if (onRequiredFailure === "throw" && failedRequiredSlots.length > 0) {
      throw new Error(
        `required fragment slots failed: ${failedRequiredSlots.join(", ")}`,
      );
    }
    return { slots: slotResults, data: dataResults, health, hints };
  })();

  return {
    slots: Object.fromEntries(
      [...slotDeferreds].map(([name, deferred]) => [name, deferred.promise]),
    ),
    result,
  };
}

export async function executeFragmentSlots(
  options: FetchFragmentSlotsOptions,
): Promise<FragmentSlotsExecution> {
  return streamFragmentSlots(options).result;
}

function directDependencyKeys(node: ScheduledNode): string[] {
  if (node.type === "data")
    return node.dependsOn.map((dependency) => `data:${dependency}`);
  return [
    ...(node.slot.dependsOn ?? []).map((dependency) => `slot:${dependency}`),
    ...(node.slot.dataDependencies ?? []).map(
      (dependency) => `data:${dependency}`,
    ),
  ];
}

export function createSlotDataExecutionPlan({
  slots,
  dataDependencies = [],
  maxSerialLevels = 3,
}: {
  slots: FragmentSlotDefinition[];
  dataDependencies?: DataDependencyDefinition[];
  maxSerialLevels?: number;
}): SlotDataExecutionPlan {
  const nodes = new Map<string, ScheduledNode>();
  for (const dependency of dataDependencies) {
    const key = `data:${dependency.id}`;
    if (nodes.has(key))
      throw new Error(`duplicate data dependency "${dependency.id}"`);
    nodes.set(key, {
      type: "data",
      key,
      id: dependency.id,
      dependsOn: dependency.dependsOn ?? [],
    });
  }
  for (const slot of slots) {
    const key = `slot:${slot.name}`;
    if (nodes.has(key))
      throw new Error(`duplicate fragment slot "${slot.name}"`);
    nodes.set(key, { type: "slot", key, slot });
  }
  for (const slot of slots) {
    for (const id of slot.dataDependencies ?? []) {
      const key = `data:${id}`;
      if (!nodes.has(key))
        nodes.set(key, { type: "data", key, id, dependsOn: [] });
    }
  }

  for (const dependency of dataDependencies) {
    for (const parent of dependency.dependsOn ?? []) {
      if (!nodes.has(`data:${parent}`))
        throw new Error(
          `data dependency "${dependency.id}" depends on missing data "${parent}"`,
        );
    }
  }
  for (const slot of slots) {
    for (const dependency of slot.dependsOn ?? []) {
      if (!nodes.has(`slot:${dependency}`))
        throw new Error(
          `fragment slot "${slot.name}" depends on missing slot "${dependency}"`,
        );
    }
  }

  const remaining = new Set(nodes.keys());
  const completed = new Set<string>();
  const levels: ScheduledNode[][] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .map((key) => nodes.get(key) as ScheduledNode)
      .filter((node) =>
        directDependencyKeys(node).every((dependency) =>
          completed.has(dependency),
        ),
      );
    if (ready.length === 0) {
      throw new Error(
        `dependency cycle detected: ${[...remaining].join(", ")}`,
      );
    }
    levels.push(ready);
    for (const node of ready) {
      remaining.delete(node.key);
      completed.add(node.key);
    }
  }

  return { levels, hints: collectSchedulerHints(levels, maxSerialLevels) };
}

export function createFragmentSlotExecutionPlan(
  slots: FragmentSlotDefinition[],
): FragmentSlotExecutionPlan {
  const { levels } = createSlotDataExecutionPlan({ slots });
  return levels
    .map((level) =>
      level
        .filter(
          (node): node is ScheduledNode & { type: "slot" } =>
            node.type === "slot",
        )
        .map((node) => node.slot),
    )
    .filter((level) => level.length > 0);
}

function collectSchedulerHints(
  levels: ScheduledNode[][],
  maxSerialLevels: number,
): SchedulerHint[] {
  const hints: SchedulerHint[] = [];
  const nodeByKey = new Map<string, ScheduledNode>();
  const levelOf = new Map<string, number>();
  levels.forEach((level, index) => {
    for (const node of level) {
      nodeByKey.set(node.key, node);
      levelOf.set(node.key, index);
    }
  });

  const closures = new Map<string, Set<string>>();
  function transitiveDependencies(key: string): Set<string> {
    const cached = closures.get(key);
    if (cached) return cached;
    const closure = new Set<string>();
    closures.set(key, closure);
    const node = nodeByKey.get(key);
    if (!node) return closure;
    for (const dependency of directDependencyKeys(node)) {
      closure.add(dependency);
      for (const transitive of transitiveDependencies(dependency))
        closure.add(transitive);
    }
    return closure;
  }

  const splitNames = (keys: string[]) => ({
    slots: keys
      .filter((key) => key.startsWith("slot:"))
      .map((key) => key.slice("slot:".length)),
    data: keys
      .filter((key) => key.startsWith("data:"))
      .map((key) => key.slice("data:".length)),
  });

  if (levels.length > maxSerialLevels) {
    const chain = [levels[levels.length - 1][0].key];
    for (let level = levels.length - 1; level > 0; level -= 1) {
      const head = nodeByKey.get(chain[0]) as ScheduledNode;
      const parent = directDependencyKeys(head).find(
        (dependency) => levelOf.get(dependency) === level - 1,
      ) as string;
      chain.unshift(parent);
    }
    const { slots, data } = splitNames(chain);
    hints.push({
      kind: "long-serial-chain",
      slots,
      data,
      message: `execution plan has ${levels.length} serial levels (threshold ${maxSerialLevels}); longest chain: ${chain.join(" -> ")}; consider removing or parallelizing dependencies`,
    });
  }

  for (let level = 1; level < levels.length; level += 1) {
    for (const node of levels[level]) {
      if (node.type !== "slot") continue;
      const closure = transitiveDependencies(node.key);
      const unrelated: string[] = [];
      for (let earlier = 0; earlier < level; earlier += 1) {
        for (const candidate of levels[earlier]) {
          if (!closure.has(candidate.key)) unrelated.push(candidate.key);
        }
      }
      if (unrelated.length === 0) continue;
      const { slots, data } = splitNames(unrelated);
      hints.push({
        kind: "unnecessary-barrier",
        slots: [node.slot.name, ...slots],
        data,
        message: `slot "${node.slot.name}" waits behind earlier levels containing unrelated nodes (${unrelated.join(", ")}); the level barrier delays it unnecessarily`,
      });
    }
  }

  const dataUsageLevels = new Map<string, Set<number>>();
  const dataUsageSlots = new Map<string, string[]>();
  levels.forEach((level, index) => {
    for (const node of level) {
      if (node.type !== "slot") continue;
      for (const id of node.slot.dataDependencies ?? []) {
        const usage = dataUsageLevels.get(id) ?? new Set<number>();
        usage.add(index);
        dataUsageLevels.set(id, usage);
        const users = dataUsageSlots.get(id) ?? [];
        users.push(node.slot.name);
        dataUsageSlots.set(id, users);
      }
    }
  });
  for (const [id, usage] of dataUsageLevels) {
    if (usage.size < 2) continue;
    const users = dataUsageSlots.get(id) ?? [];
    hints.push({
      kind: "duplicate-data-resolution",
      slots: users,
      data: [id],
      message: `data "${id}" is required by slots across ${usage.size} execution levels (${users.join(", ")}); it is resolved once and reused, keep a single shared resolution instead of per-level reads`,
    });
  }

  return hints;
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
  const strategy = slot.strategy ?? DEFAULT_RENDER_STRATEGY;
  // Normalize once: the deprecated "isr" alias compares as "ttl-cache"
  // internally while the reported strategy keeps the configured value.
  const normalizedStrategy = normalizeRenderStrategy(strategy);
  const slotSpanId = trace?.startSpan(`slot:${slot.name}`, "fragment", {
    parentId: parentSpanId,
    attributes: {
      slot: slot.name,
      fragment: slot.fragment,
      strategy,
      channel: slot.channel ?? "stable",
      dependsOn: slot.dependsOn ?? [],
      dataDependencies: slot.dataDependencies ?? [],
      required: slot.required ?? false,
    },
  });
  for (const dependency of slot.dependsOn ?? []) {
    if (slotSpanId)
      trace?.addDependency(`slot:${dependency}`, slotSpanId, "depends-on");
  }
  for (const dependency of slot.dataDependencies ?? []) {
    if (slotSpanId)
      trace?.addDependency(`data:${dependency}`, slotSpanId, "depends-on");
  }
  try {
    if (normalizedStrategy === "static") {
      const result: FragmentSlotResult = {
        slot,
        strategy,
        source: "static",
        status: "ok",
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
        status: "fallback",
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
    const cacheable =
      normalizedStrategy === "cached-ssr" || normalizedStrategy === "ttl-cache";
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
          status: "ok",
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

    if (cacheKey && !isFallbackResponse(response)) {
      const ttl = slot.cachePolicy?.ttl ?? response.cache.ttl;
      if (ttl > 0)
        cache.set(cacheKey, { expiresAt: now() + ttl * 1000, response });
    }

    const source = isFallbackResponse(response)
      ? ("fallback" as const)
      : ("network" as const);
    const result: FragmentSlotResult = {
      slot,
      strategy,
      source,
      status: source === "fallback" ? "fallback" : "ok",
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
    // Normalized so "isr" and "ttl-cache" slots share cache entries.
    strategy: normalizeRenderStrategy(slot.strategy ?? DEFAULT_RENDER_STRATEGY),
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
