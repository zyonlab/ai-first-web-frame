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
- `requestJson<T>(endpointId: string, options?: RequestJsonOptions<T>): Promise<RequestResult<T>>`
  — the only call surface. `RequestJsonOptions<T>` is
  `{ path?, method?: "GET"|"POST"|"PUT"|"PATCH"|"DELETE", body?, headers?, timeoutMs?, retries?, responseSchema? }`.
  Returns `{ data: T, endpoint: ApiEndpointPolicy, url: string, attempts: number, durationMs: number }`.
  `endpointId` must match an `id` in `policy.endpoints`; per-call `timeoutMs`/
  `retries` override the endpoint's and are still capped by
  `policy.maxRetries`.
- `responseSchema?: ResponseSchema<T>` (inside `RequestJsonOptions<T>`) —
  opt-in response payload validation. `ResponseSchema<T>` is a minimal
  structural type (`safeParse` + optional `description`) that any Zod schema
  satisfies without this package depending on Zod. When present, the JSON body
  is `safeParse`d and the *parsed* value is returned (so Zod stripping/
  defaults/transforms apply); a mismatch throws `RequestContractError`. When
  absent, behavior is unchanged (the body is cast to `T`). Deliberately a
  per-call option, NOT part of `ApiEndpointPolicy`: policies are serializable
  contracts, runtime schemas are code.
- `RequestPolicyError` (class extends `Error`, `name === "RequestPolicyError"`)
  — see error taxonomy.
- `RequestTimeoutError` (class extends `Error`, `name === "RequestTimeoutError"`)
  — see error taxonomy.
- `RequestContractError` (class extends `Error`,
  `name === "RequestContractError"`, fields `endpointId`/`url`/`schemaName`/
  `issues: ResponseSchemaIssue[]`) — see error taxonomy.

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
- **`RequestContractError`** — thrown when `options.responseSchema` is set and
  the JSON body fails `safeParse` (`response from endpoint "<id>" (<url>)
  violates <schemaName> — <path>: <message>`). `schemaName` comes from the
  schema's `description` (Zod's `.describe(...)`), falling back to
  `responseSchema`; the structured `issues` ride on the error. **Never
  retried** — shape drift is deterministic, so a violation exhausts the retry
  budget immediately even when `retries > 0`. Only possible when the caller
  opted in; without `responseSchema` the body is cast, never parsed.
- **Generic `Error`** — any non-2xx HTTP response (`request status <code>`) or
  network-level fetch rejection; retried up to `min(options.retries ??
  endpoint.retries ?? 0, policy.maxRetries)` times, then the last error is
  re-thrown as-is (or wrapped in `new Error(String(lastError))` if it was not
  already an `Error`).

`requestJson` never returns a partial/degraded result on failure — on
exhausted retries it always rejects. Callers that want fallback-on-failure
behavior (like `@mvp/runtime`) must catch at the call site.

## Example

```ts no-run
import { createRequestClient, RequestContractError, RequestPolicyError, RequestTimeoutError } from "@mvp/request";
import { createRequestContext } from "@mvp/request-context";
import type { RequestPolicy } from "@mvp/contracts";
import { z } from "zod";

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
  const { data } = await client.requestJson("pricing-api", {
    path: "/v1/quote?symbol=BTC-USD",
    // Opt-in payload validation: the parsed body is returned; a shape drift
    // throws RequestContractError (never retried) instead of flowing
    // typed-but-wrong into rendering. Omit responseSchema for the legacy
    // cast-to-T behavior.
    responseSchema: z.object({ price: z.number() }).describe("QuoteSchema"),
  });
  console.log(data.price);
} catch (error) {
  if (error instanceof RequestTimeoutError) {
    console.error("pricing-api timed out");
  } else if (error instanceof RequestPolicyError) {
    console.error("misconfigured request:", error.message);
  } else if (error instanceof RequestContractError) {
    console.error(`upstream drift: ${error.schemaName}`, error.issues);
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
(`RequestTimeoutError`), the opt-in `responseSchema` paths
(`RequestContractError` naming the schema, contract violations never retried),
and the retry/backoff counting in `RequestResult.attempts`.
