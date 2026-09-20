# Request context

One validated object travels with every render, across process boundaries, as HTTP headers.

## Shape

`RequestContextSchema` (`@mvp/contracts`) — required fields first:

| Field | Type | Notes |
| --- | --- | --- |
| `traceId` | string, min 8 | ties fragment spans to one page request |
| `requestId` | string, min 4 | |
| `locale` | string, min 2 | |
| `tenant` | string, min 1 | |
| `featureFlags` | record of boolean\|string\|number | required, may be `{}` |
| `timestamp` | ISO datetime | |
| `experiment` | record of string | defaults to `{}` |
| `theme` | `light`\|`dark`\|`system` | defaults to `system` |
| `device` | `mobile`\|`tablet`\|`desktop`\|`bot`\|`unknown` | defaults to `unknown` |
| `userAgent` | string | defaults to `""` |
| `user`, `session`, `ip` | optional | |
| `extensions` | record of string | defaults to `{}` — see below |

```ts
import { createRequestContext } from "@mvp/request-context";

const ctx = createRequestContext({ headers: { "x-locale": "en-US", "x-tenant": "acme" } });
```

Accessors: `getLocale`, `getTenant`, `getTraceId`, `getUser`, `getFeatureFlags`,
`getContextExtension`.

## Adding a dimension without touching the framework

The wrong way is to widen `RequestContextSchema` — that is a framework package, and the layering
rule forbids product code from editing it, so "add a field" would mean changing the framework for
a business need.

The right way is `extensions`:

```ts
const ctx = createRequestContext({
  headers,
  extensions: { abBucket: "b", acquisitionChannel: "paid-search", tier: "gold" },
});

getContextExtension(ctx, "abBucket"); // "b"
```

Values are strings because they cross an HTTP boundary. Each one propagates as
`x-mvp-ctx-<name>` (`CONTEXT_EXTENSION_HEADER_PREFIX`).

This is the schema-validated equivalent of `@podium/context`'s `.register(name, parser)`
extension point.

## Crossing the wire

```ts
import { serializeContext, deserializeContext } from "@mvp/request-context";

const headers = serializeContext(ctx);   // -> flat header record
const ctx2 = deserializeContext(headers);
```

`ContextParser` is the type for a custom parser if you need to derive a dimension from raw
headers rather than pass it in.

## Context and caching

`cachePolicy.vary` on a slot names the context dimensions that partition its cache key. A
fragment whose output depends on `tenant` must declare `vary: ["tenant"]`, or two tenants will
share one cache entry. `createFragmentCacheKey` is the function that builds the key, and
`createDataKey` does the equivalent for data sources.

## The lenient tier

`POST /render` accepts a **partial** context: `parseFragmentRenderRequest` tries the strict
schema first, then an envelope in which `ctx` is `.partial().optional()`, and only answers `400`
when both fail. Convenient for hand-testing a service with curl; see
[F14](../known-limitations.md#f14) for why you cannot currently observe whether production
traffic is landing on that tier.
