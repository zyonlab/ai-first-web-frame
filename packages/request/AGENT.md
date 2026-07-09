# @mvp/request — AGENT.md

## What this package is for

`@mvp/request` is the framework's only sanctioned way to call an external
HTTP API from business code (`no bare fetch(...)` is enforced by
`pnpm audit:deps`). It wraps `fetch` with a declared `RequestPolicy`
(`@mvp/contracts`): every call targets a named endpoint that must be
pre-registered in the policy, enforces the endpoint's allowed HTTP methods,
applies a timeout via `AbortController`, retries up to the policy's cap, and
stamps every request with the current `RequestContext` as headers (via
`@mvp/request-context`'s `serializeContext`). It optionally emits spans onto an
`@mvp/observability` `RequestTrace`.

## Entry points

- `createRequestClient(options: RequestClientOptions): { requestJson }` — the
  only factory. `RequestClientOptions` is
  `{ ctx: RequestContext, policy: RequestPolicy, fetchImpl?: typeof fetch, trace?: RequestTrace }`.
  Build one client per request (it captures `ctx`) and reuse `requestJson` for
  every call in that request's lifecycle.
- `requestJson<T>(endpointId: string, options?: RequestJsonOptions): Promise<RequestResult<T>>`
  — the only call surface. `RequestJsonOptions` is
  `{ path?, method?: "GET"|"POST"|"PUT"|"PATCH"|"DELETE", body?, headers?, timeoutMs?, retries? }`.
  Returns `{ data: T, endpoint: ApiEndpointPolicy, url: string, attempts: number, durationMs: number }`.
  `endpointId` must match an `id` in `policy.endpoints`; per-call `timeoutMs`/
  `retries` override the endpoint's and are still capped by
  `policy.maxRetries`.
- `RequestPolicyError` (class extends `Error`, `name === "RequestPolicyError"`)
  — see error taxonomy.
- `RequestTimeoutError` (class extends `Error`, `name === "RequestTimeoutError"`)
  — see error taxonomy.

## Error taxonomy

- **`RequestPolicyError`** — thrown synchronously, before any network call, in
  three cases: (1) `endpointId` is not a key in `policy.endpoints`
  (`endpoint "<id>" is not allowed`); (2) the resolved HTTP `method` is not in
  that endpoint's `allowedMethods` (`method <M> is not allowed for endpoint
  "<id>"`); (3) `options.path` is an absolute URL whose origin differs from the
  endpoint's `baseUrl` (`cross-origin path is not allowed: <path>`). Never
  retried — these are caller/config bugs, not transient failures.
- **`RequestTimeoutError`** — thrown when the in-flight fetch does not resolve
  within `timeoutMs` (`request timed out after <ms>ms`); the internal
  `AbortController` is aborted and the error is re-thrown from the `AbortError`
  DOMException case too, so callers only ever see `RequestTimeoutError` for
  timeouts, never a raw `AbortError`. Subject to the endpoint's retry budget
  like any other failure.
- **Generic `Error`** — any non-2xx HTTP response (`request status <code>`) or
  network-level fetch rejection; retried up to `min(options.retries ??
  endpoint.retries ?? 0, policy.maxRetries)` times, then the last error is
  re-thrown as-is (or wrapped in `new Error(String(lastError))` if it was not
  already an `Error`).

`requestJson` never returns a partial/degraded result on failure — on
exhausted retries it always rejects. Callers that want fallback-on-failure
behavior (like `@mvp/runtime`) must catch at the call site.

## Example

```ts
import { createRequestClient, RequestPolicyError, RequestTimeoutError } from "@mvp/request";
import { createRequestContext } from "@mvp/request-context";
import type { RequestPolicy } from "@mvp/contracts";

const policy: RequestPolicy = {
  endpoints: [
    {
      id: "pricing-api",
      baseUrl: "https://pricing.internal.example.com",
      allowedMethods: ["GET"],
      timeoutMs: 500,
      retries: 1,
      privacy: "public",
    },
  ],
  defaultTimeoutMs: 500,
  maxRetries: 2,
};

const client = createRequestClient({ ctx: createRequestContext(), policy });

try {
  const { data } = await client.requestJson<{ price: number }>("pricing-api", {
    path: "/v1/quote?symbol=BTC-USD",
  });
  console.log(data.price);
} catch (error) {
  if (error instanceof RequestTimeoutError) {
    console.error("pricing-api timed out");
  } else if (error instanceof RequestPolicyError) {
    console.error("misconfigured request:", error.message);
  } else {
    throw error;
  }
}
```

## Accept

```
pnpm --filter @mvp/request test
```
Expected: Vitest exits 0. `packages/request/src/index.test.ts` exercises the
policy-rejection paths (`RequestPolicyError`), the timeout path
(`RequestTimeoutError`), and the retry/backoff counting in `RequestResult.attempts`.
