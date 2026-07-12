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

/** One validation failure reported by a {@link ResponseSchema}. */
export type ResponseSchemaIssue = {
  path: Array<string | number>;
  message: string;
};

/**
 * Minimal structural contract for an opt-in response payload schema. Any Zod
 * schema satisfies it (`safeParse` + the `.describe(...)` description), but
 * the package does not depend on Zod — mirroring how `@mvp/interaction`
 * accepts zod-like `payloadSchema` carriers.
 */
export type ResponseSchema<T> = {
  safeParse: (
    value: unknown,
  ) =>
    | { success: true; data: T }
    | { success: false; error: { issues: ResponseSchemaIssue[] } };
  /** Used to name the schema in {@link RequestContractError}. */
  description?: string;
};

export type RequestJsonOptions<T = unknown> = {
  path?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /**
   * Opt-in response payload validation. When present, the JSON body is
   * `safeParse`d and the parsed value is returned; a mismatch throws
   * {@link RequestContractError} without retrying (shape drift is
   * deterministic, not transient). When absent, behavior is unchanged: the
   * body is cast to `T` as before.
   *
   * Deliberately a per-call option and NOT part of `ApiEndpointPolicy`:
   * policies are serializable contracts (see `ApiEndpointPolicySchema` in
   * `@mvp/contracts`) while runtime schemas are code, so schema-to-policy
   * wiring is out of scope.
   */
  responseSchema?: ResponseSchema<T>;
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

/**
 * A response body that violated the caller's `responseSchema`. Carries the
 * offending url/endpoint, the schema name, and the structured issues so the
 * failure is diagnosable without re-fetching. Never retried.
 */
export class RequestContractError extends Error {
  readonly endpointId: string;
  readonly url: string;
  readonly schemaName: string;
  readonly issues: ResponseSchemaIssue[];

  constructor(options: {
    endpointId: string;
    url: string;
    schemaName: string;
    issues: ResponseSchemaIssue[];
  }) {
    const first = options.issues[0];
    super(
      `response from endpoint "${options.endpointId}" (${options.url}) violates ${options.schemaName}${
        first ? ` — ${first.path.join(".") || "(root)"}: ${first.message}` : ""
      }`,
    );
    this.name = "RequestContractError";
    this.endpointId = options.endpointId;
    this.url = options.url;
    this.schemaName = options.schemaName;
    this.issues = options.issues;
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
    options: RequestJsonOptions<T> = {},
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
        const data = parseResponseBody<T>(
          await response.json(),
          options.responseSchema,
          endpointId,
          url,
        );
        const durationMs = performance.now() - startedAt;
        trace?.endSpan(spanId ?? "", {
          status: "ok",
          attributes: { attempts: attempt, durationMs },
        });
        return { data, endpoint, url, attempts: attempt, durationMs };
      } catch (error) {
        lastError = error;
        // A contract violation is deterministic — retrying re-fetches the
        // same wrong shape, so it exhausts the budget immediately.
        if (error instanceof RequestContractError) break;
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

function parseResponseBody<T>(
  raw: unknown,
  schema: ResponseSchema<T> | undefined,
  endpointId: string,
  url: string,
): T {
  if (!schema) return raw as T;
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new RequestContractError({
      endpointId,
      url,
      schemaName: schema.description ?? "responseSchema",
      issues: result.error.issues,
    });
  }
  return result.data;
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
