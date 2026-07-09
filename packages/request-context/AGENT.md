# @mvp/request-context — AGENT.md

## What this package is for

`@mvp/request-context` builds, freezes, serializes, and deserializes the
framework's `RequestContext` (`@mvp/contracts`) — the one object every layer
(shell, page, fragment, request client) reads for locale, tenant, user,
feature flags, theme, device, and trace/request ids. It is the boundary
adapter between raw HTTP headers (Node `IncomingMessage`-like objects, a
`Headers` instance, or a plain header map) and the validated, frozen
`RequestContext` shape. Every other framework package that needs context
(`@mvp/runtime`, `@mvp/request`) imports the type from `@mvp/contracts` and the
serialize/deserialize helpers from here — never re-parses headers itself.

## Entry points

- `createRequestContext(reqLike?: ReqLike): Readonly<RequestContext>` — reads
  `x-trace-id`, `x-request-id`, `x-locale`, `x-tenant`, `x-user-id`,
  `x-user-role`, `x-session-id`, `x-flags`, `x-theme`, `x-device`,
  `user-agent`, `x-forwarded-for` (falling back to `reqLike.ip` /
  `reqLike.socket.remoteAddress`) off `reqLike.headers`, fills in defaults
  (`locale: "en-US"`, `tenant: "default"`, `theme: "system"`,
  `device: "unknown"`, generated `traceId`/`requestId`), validates the result
  against `RequestContextSchema`, and deep-freezes it. Call this once per
  incoming request at the edge (shell gateway, page route handler, fragment
  server).
- `serializeContext(ctx: RequestContext): Record<string, string>` — the
  inverse direction: turns a `RequestContext` back into the `x-trace-id` /
  `x-request-id` / `x-locale` / `x-tenant` / `x-flags` / `x-theme` / `x-device`
  header set (flags encoded as `key=value` comma pairs). Used by
  `@mvp/runtime`'s `createFragmentHeaders` and `@mvp/request` to propagate
  context downstream over HTTP.
- `deserializeContext(headersOrObject): Readonly<RequestContext>` — alias for
  `createRequestContext({ headers: headersOrObject })`; use when you already
  have a header-shaped object rather than a request-like object.
- `getLocale(ctx)`, `getTenant(ctx)`, `getUser(ctx)`, `getFeatureFlags(ctx)`,
  `getTraceId(ctx)` — narrow accessors, useful for keeping call sites
  self-documenting instead of destructuring `ctx` directly.

## Error taxonomy

- **`ZodError`** (from `@mvp/contracts`'s `RequestContextSchema.parse`) —
  thrown by `createRequestContext`/`deserializeContext` only if a header value
  fails schema validation after defaulting, e.g. a syntactically-present
  `x-locale` header that resolves to a string shorter than 2 characters
  (`RequestContextSchema` requires `locale: z.string().min(2)`), or an
  `x-trace-id`/`x-request-id` shorter than the schema's `min(8)`/`min(4)` when
  a caller-supplied value is present but malformed. There is no other error
  type in this package — malformed/absent headers are otherwise defaulted, not
  rejected.

## Example

```ts
import { createRequestContext, serializeContext, getTenant } from "@mvp/request-context";

// At the edge (e.g. a Fastify or Next.js route handler):
const ctx = createRequestContext({
  headers: {
    "x-trace-id": "trace-0123456789",
    "x-tenant": "acme",
    "x-locale": "en-GB",
    "x-flags": "newCheckout=true,betaWidth=42",
  },
});

console.log(getTenant(ctx)); // "acme"
console.log(ctx.featureFlags.newCheckout); // true
console.log(ctx.featureFlags.betaWidth); // 42

// Propagate downstream to a fragment/API call:
const headers = serializeContext(ctx);
console.log(headers["x-tenant"]); // "acme"
```

## Accept

```
pnpm --filter @mvp/request-context test
```
Expected: Vitest exits 0. `packages/request-context/src/index.test.ts` covers
header parsing/defaulting, flag parsing (`parseFlags`), round-trip
serialize/deserialize, and the frozen-object invariant.
