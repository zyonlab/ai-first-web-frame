# AI Micro Component MVP

Production-ready MVP framework for independently deployable React page apps and SSR business fragments.

## Quick Start

```txt
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm verify
```

## Constraints

- pnpm only. Do not use npm, npx, or yarn.
- Default type checking uses `@typescript/native-preview` through `scripts/tsgo-typecheck.mts`.
- Packages build with `tsdown`.
- Next dev uses Turbopack.
- Lint uses Oxlint. Format/check uses Biome.

## Local Services

```txt
pnpm dev:shell
pnpm dev:page-home
pnpm dev:page-product
pnpm dev:fragment:promotion-banner
pnpm dev:fragment:recommendation-widget
```

Page apps compose SSR business fragments through the fragment registry and each fragment service's `/render` endpoint. The shell gateway routes page requests through the route registry.

## Docker Compose

```txt
docker compose -f infra/docker/docker-compose.yml config
docker compose -f infra/docker/docker-compose.yml build --provenance=false --sbom=false
docker compose -f infra/docker/docker-compose.yml up -d --no-build --force-recreate
```

Compose uses internal service DNS names, for example `http://page-home:4101` and `http://promotion-banner:4201`, so container traffic does not depend on localhost routing.

Browser-facing demo endpoints:

- `http://localhost:4100/` - shell gateway composed home route with a visible shell marker.
- `http://localhost:4101/` - standalone page-home app without the shell marker.
- `http://localhost:4102/` - redirects to the product demo at `/product/123`.
- `http://localhost:4201/` - promotion-banner fragment service demo and endpoint list.
- `http://localhost:4202/` - recommendation-widget fragment service demo and endpoint list.

## Render Strategies

The framework supports slot-level render strategies through page manifests and the runtime scheduler:

- `static` - no runtime fragment service call; emits prerender-safe HTML.
- `ttl-cache` - runtime fetch with TTL cache semantics for revalidation-style content (formerly aliased `isr`; the alias is retired and now rejected).
- `cached-ssr` - SSR fragment call with a bounded cache key.
- `dynamic-ssr` - SSR fragment call on every request with timeout and fallback.

Demo coverage:

- `page-home` static editorial block: `static`.
- `page-home` promotion banner: `cached-ssr`.
- `page-home` recommendations: `dynamic-ssr`.
- `page-product` static proof block: `static`.
- `page-product` product promotion: `ttl-cache`.
- `page-product` recommendations: `dynamic-ssr`.

The runtime scheduler executes fragment slots in parallel, isolates failures with fallback HTML, and uses cache keys derived from fragment, version, tenant, locale, experiment, and props.

## Framework Defaults and Trace

Common request capabilities are framework-owned by default:

- `@mvp/request-context` creates a safe request context for tenant, locale, theme, device, flags, trace ID, and request ID.
- `@mvp/runtime` serializes only the safe context headers when calling SSR fragment services.
- Page apps declare fragment slots and can override strategy, timeout, props, cache policy, and dependency metadata per slot.
- Fragment services receive context and props, but do not own global CSS, fonts, theme, locale, or shell security policy.

`@mvp/observability` provides request tracing for tuning composed SSR pages. A page can create a trace with `createRequestTrace()` and pass it to `fetchFragmentSlots()`. The runtime records scheduler, slot, network, cache, static, and fallback spans, then exports JSON or a dependency graph log:

```ts
const trace = createRequestTrace({ traceId: ctx.traceId, requestId: ctx.requestId });
const slots = await fetchFragmentSlots({ slots, registry, ctx, trace });
console.log(trace.toDependencyGraphLog());
```

The home and product demos render a `Request trace` section showing one request's fragment scheduling path and durations.

## Quality Gates

`pnpm verify` runs 13 gates (see `scripts/verify.mts`): typecheck, lint, format check, `verify:manifest-gen` (page manifest codegen sync), `docs:test` (executes every AGENT.md fenced TypeScript snippet), unit tests, build, and six audits (similarity, bundle, CSS, dependency, optimizer, server/client boundary). Reports are written to `reports/`.

## Known Limitations

This is an MVP. If tsgo lacks declaration emit support, package declarations are emitted by tsdown during build while default type checking still uses tsgo.

`pnpm verify` passes typecheck, lint, format check, unit tests, build, and all audit tools. Coverage thresholds are configured and `@vitest/coverage-v8` is installed, but coverage report generation is not enabled in the default `pnpm test` path because Vitest coverage mode repeatedly stalled in this local environment. Treat 90% coverage proof as the first follow-up gate before production release.

Docker Compose configuration, image builds, container startup, and production smoke tests are verified locally. The build command disables provenance and SBOM attestation because Docker Desktop's concurrent attestation export produced intermittent snapshot errors in this environment.
