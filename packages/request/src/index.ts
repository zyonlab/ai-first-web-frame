import type {
  ApiEndpointPolicy,
  RequestContext,
  RequestPolicy,
} from "@mvp/contracts";
import type { RequestTrace } from "@mvp/observability";
import { serializeContext } from "@mvp/request-context";

export type RequestClientOptions = {
  ctx: RequestContext;
  policy: RequestPolicy;
  fetchImpl?: typeof fetch;
  trace?: RequestTrace;
};

export type RequestJsonOptions = {
  path?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
};

export type RequestResult<T> = {
  data: T;
  endpoint: ApiEndpointPolicy;
  url: string;
  attempts: number;
  durationMs: number;
};

export class RequestPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestPolicyError";
  }
}

export class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestTimeoutError";
  }
}

export function createRequestClient({
  ctx,
  policy,
  fetchImpl = fetch,
  trace,
}: RequestClientOptions) {
  const endpoints = new Map(
    policy.endpoints.map((endpoint) => [endpoint.id, endpoint]),
  );

  async function requestJson<T>(
    endpointId: string,
    options: RequestJsonOptions = {},
  ): Promise<RequestResult<T>> {
    const endpoint = endpoints.get(endpointId);
    if (!endpoint)
      throw new RequestPolicyError(`endpoint "${endpointId}" is not allowed`);

    const method = options.method ?? "GET";
    if (!endpoint.allowedMethods.includes(method))
      throw new RequestPolicyError(
        `method ${method} is not allowed for endpoint "${endpointId}"`,
      );

    const url = joinUrl(endpoint.baseUrl, options.path ?? "");
    const timeoutMs =
      options.timeoutMs ?? endpoint.timeoutMs ?? policy.defaultTimeoutMs;
    const retries = Math.min(
      options.retries ?? endpoint.retries ?? 0,
      policy.maxRetries,
    );
    const startedAt = performance.now();
    const spanId = trace?.startSpan(`request:${endpointId}`, "network", {
      attributes: { endpointId, method, url, timeoutMs, retries },
    });

    let attempt = 0;
    let lastError: unknown;
    while (attempt <= retries) {
      attempt += 1;
      try {
        const response = await fetchWithTimeout(
          fetchImpl,
          url,
          {
            method,
            headers: {
              "content-type": "application/json",
              ...serializeContext(ctx),
              ...options.headers,
            },
            body:
              options.body === undefined
                ? undefined
                : JSON.stringify(options.body),
          },
          timeoutMs,
        );
        if (!response.ok) throw new Error(`request status ${response.status}`);
        const data = (await response.json()) as T;
        const durationMs = performance.now() - startedAt;
        trace?.endSpan(spanId ?? "", {
          status: "ok",
          attributes: { attempts: attempt, durationMs },
        });
        return { data, endpoint, url, attempts: attempt, durationMs };
      } catch (error) {
        lastError = error;
        if (attempt > retries) break;
      }
    }

    trace?.endSpan(spanId ?? "", {
      status: lastError instanceof RequestTimeoutError ? "timeout" : "error",
      attributes: {
        attempts: attempt,
        error:
          lastError instanceof Error ? lastError.message : String(lastError),
      },
    });
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return { requestJson };
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Response>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RequestTimeoutError(`request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } catch (error) {
    if (
      error instanceof DOMException ||
      (error instanceof Error && error.name === "AbortError")
    )
      throw new RequestTimeoutError(`request timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function joinUrl(baseUrl: string, path: string) {
  if (!path) return baseUrl;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    const base = new URL(baseUrl);
    const target = new URL(path);
    if (base.origin !== target.origin)
      throw new RequestPolicyError(`cross-origin path is not allowed: ${path}`);
    return target.toString();
  }
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
