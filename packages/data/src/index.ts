import type {
  DataDependency,
  DataFreshness,
  RequestContext,
} from "@mvp/contracts";
import type { RequestTrace } from "@mvp/observability";

export type DataLoaderInput<TParams> = {
  ctx: RequestContext;
  params: TParams;
  signal?: AbortSignal;
};

export type DataSource<TData = unknown, TParams = Record<string, unknown>> = {
  id: string;
  dependency: DataDependency;
  load: (input: DataLoaderInput<TParams>) => TData | Promise<TData>;
};

export type DataReadResult<TData> = {
  data: TData;
  source: "loader" | "cache" | "pending";
  key: string;
  dependency: DataDependency;
};

export type DataCacheEntry = {
  expiresAt: number;
  data: unknown;
  tags: string[];
};

export type DataClientOptions = {
  ctx: RequestContext;
  sources: Array<DataSource>;
  cache?: Map<string, DataCacheEntry>;
  trace?: RequestTrace;
  now?: () => number;
};

export class DataDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataDependencyError";
  }
}

export function defineDataSource<TData, TParams = Record<string, unknown>>(
  source: DataSource<TData, TParams>,
) {
  return source;
}

export function createDataClient({
  ctx,
  sources,
  cache = new Map(),
  trace,
  now = Date.now,
}: DataClientOptions) {
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const pending = new Map<string, Promise<DataReadResult<unknown>>>();

  async function readData<TData = unknown, TParams = Record<string, unknown>>(
    sourceId: string,
    params = {} as TParams,
  ): Promise<DataReadResult<TData>> {
    const source = sourceMap.get(sourceId) as
      | DataSource<TData, TParams>
      | undefined;
    if (!source)
      throw new DataDependencyError(`data source "${sourceId}" not found`);
    validateRuntimeFreshness(source.dependency.freshness);
    const key = createDataKey(source.dependency, ctx, params);

    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) {
      const spanId = trace?.startSpan(`data:${sourceId}`, "data", {
        attributes: {
          key,
          source: "cache",
          freshness: source.dependency.freshness,
        },
      });
      trace?.endSpan(spanId ?? "", { status: "cache" });
      return {
        data: cached.data as TData,
        source: "cache",
        key,
        dependency: source.dependency,
      };
    }

    const existing = pending.get(key);
    if (existing) {
      const result = (await existing) as DataReadResult<TData>;
      return { ...result, source: "pending" };
    }

    const loadPromise = loadData(source, params, key);
    pending.set(key, loadPromise as Promise<DataReadResult<unknown>>);
    try {
      return await loadPromise;
    } finally {
      pending.delete(key);
    }
  }

  function preloadData<TParams = Record<string, unknown>>(
    sourceId: string,
    params = {} as TParams,
  ) {
    void readData(sourceId, params);
  }

  function mutateData(tagOrKey: string) {
    for (const [key, entry] of cache.entries()) {
      if (key === tagOrKey || entry.tags.includes(tagOrKey)) cache.delete(key);
    }
  }

  function subscribeData(
    sourceId: string,
    handler: (event: { sourceId: string; ctx: RequestContext }) => void,
  ) {
    const source = sourceMap.get(sourceId);
    if (!source)
      throw new DataDependencyError(`data source "${sourceId}" not found`);
    if (
      source.dependency.freshness !== "realtime" &&
      source.dependency.freshness !== "near-realtime"
    )
      throw new DataDependencyError(
        `data source "${sourceId}" is not subscribable`,
      );
    handler({ sourceId, ctx });
    return () => undefined;
  }

  async function loadData<TData, TParams>(
    source: DataSource<TData, TParams>,
    params: TParams,
    key: string,
  ): Promise<DataReadResult<TData>> {
    const spanId = trace?.startSpan(`data:${source.id}`, "data", {
      attributes: {
        key,
        source: "loader",
        freshness: source.dependency.freshness,
        privacy: source.dependency.privacy,
      },
    });
    try {
      const data = await source.load({ ctx, params });
      const ttl = source.dependency.cachePolicy?.ttl ?? 0;
      if (ttl > 0 && source.dependency.freshness !== "realtime") {
        cache.set(key, {
          data,
          expiresAt: now() + ttl * 1000,
          tags: [
            ...(source.dependency.cachePolicy?.tags ?? []),
            ...source.dependency.invalidationTags,
          ],
        });
      }
      trace?.endSpan(spanId ?? "", { status: "ok" });
      return { data, source: "loader", key, dependency: source.dependency };
    } catch (error) {
      trace?.endSpan(spanId ?? "", {
        status: "error",
        attributes: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  return {
    readData,
    preloadData,
    mutateData,
    subscribeData,
  };
}

export function createDataKey(
  dependency: DataDependency,
  ctx: RequestContext,
  params: unknown,
) {
  const parts: Record<string, unknown> = {
    id: dependency.id,
    freshness: dependency.freshness,
    params,
  };
  if (dependency.privacy !== "public") parts.tenant = ctx.tenant;
  if (dependency.privacy === "user-segment") parts.experiment = ctx.experiment;
  if (dependency.privacy === "user-private") parts.user = ctx.user?.id;
  return stableStringify(parts);
}

export function validateRuntimeFreshness(freshness: DataFreshness) {
  if (freshness === "client-local")
    throw new DataDependencyError(
      "client-local data cannot be read during SSR",
    );
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
