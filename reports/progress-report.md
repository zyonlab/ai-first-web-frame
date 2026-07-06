# MVP Progress Report

Generated on 2026-07-06.

## Done

- pnpm workspace with independent apps, fragments, packages, tools, platform registries, docs, CI, Docker, k8s, Verdaccio, and Argo examples.
- tsgo typecheck script scans apps, fragments, packages, and tools and writes `reports/typecheck-report.json`.
- Contracts, request context, runtime, design tokens, observability, and UI packages implemented with tests.
- Shell gateway, page-home, page-product, promotion-banner, and recommendation-widget implemented as separate release units.
- Page apps now compose real SSR fragment services through the fragment registry and `/render` endpoints, with bounded fallbacks.
- Runtime now supports slot-level render strategies: `static`, `isr`, `cached-ssr`, and `dynamic-ssr`.
- Fragment slots are scheduled through a DAG-aware runtime scheduler with dependency levels, cycle detection, timeout, fallback, and TTL cache support.
- Production-ready contract planning schemas added for data freshness, asset/font/theme/i18n manifests, request policies, storage/cookie policies, worker manifests, interaction contracts, release manifests, and optimization findings.
- `@mvp/request` added as the framework request broker with endpoint allowlist, method policy, timeout, retry, safe context propagation, and trace integration.
- `@mvp/data` added as the framework data broker with SSR request dedupe, TTL cache, tag invalidation, data freshness validation, subscription guards, partitioned keys, and trace integration.
- `@mvp/assets` added for CSS/JS/font/theme/i18n asset collection, deterministic ordering, dedupe policy, and CSP/SRI metadata preservation.
- `@mvp/storage` added for storage policy validation, privacy partition keys, deterministic storage keys, and cookie policy helpers.
- `@mvp/workers` added for worker manifest validation and typed task descriptions across browser/server worker kinds.
- `@mvp/optimizer` added for trace-driven duplicate request/data detection and SSG/static slot candidate findings.
- Home and product layouts now consume `@mvp/assets` to inject framework-owned theme and i18n assets through the app shell head.
- Home and product demos now use `@mvp/data` to show shared data dependency dedupe in addition to fragment render strategy diagnostics.
- `@mvp/optimization-audit` added to turn page slot manifests into SSG/static optimization findings and write `reports/optimization-findings.json` plus `reports/optimization-findings.md`.
- Docker Compose now uses monorepo-root build contexts and container DNS service URLs for page-to-fragment and shell-to-page calls.
- Browser-facing demo entrypoints are available for shell, standalone page apps, and standalone fragment services.
- Quality tools implemented: similarity, bundle budget, CSS budget, dependency audit, optimizer audit, server/client boundary, and create-component.
- Dependency audit now blocks raw `fetch(...)` calls in page/fragment business code so data and network access go through `@mvp/request` or `@mvp/data`.
- `pnpm verify` passes and writes `reports/verify-report.json`.

## Verified

- `pnpm typecheck`
- `pnpm lint`
- `pnpm check`
- `pnpm test`
- `pnpm build`
- `pnpm audit:similarity`
- `pnpm audit:bundle`
- `pnpm audit:css`
- `pnpm audit:deps`
- `pnpm audit:optimizer`
- `pnpm audit:boundary`
- `pnpm verify`
- `pnpm install --offline --ignore-scripts` to refresh workspace links for new internal packages.
- `pnpm --filter @mvp/assets test`
- `pnpm --filter @mvp/contracts test`
- `pnpm --filter @mvp/data test`
- `pnpm --filter @mvp/optimizer test`
- `pnpm --filter @mvp/optimization-audit test`
- `pnpm --filter @mvp/page-home test`
- `pnpm --filter @mvp/page-product test`
- `pnpm --filter @mvp/request test`
- `pnpm --filter @mvp/runtime test`
- `pnpm --filter @mvp/storage test`
- `pnpm --filter @mvp/workers test`
- `docker compose -f infra/docker/docker-compose.yml config`
- `docker pull node:22-alpine`
- `docker compose -f infra/docker/docker-compose.yml build --provenance=false --sbom=false`
- `docker compose -f infra/docker/docker-compose.yml up -d --no-build --force-recreate`
- Docker production smoke for shell home, shell product, and direct fragment `/render` endpoints.
- Browser smoke for `4100`, `4101`, `4102`, `4201`, and `4202` root entrypoints.
- Demo strategy coverage: home `static`/`cached-ssr`/`dynamic-ssr`; product `static`/`isr`/`dynamic-ssr`.
- Demo data coverage: home `home-featured-content` and product `product-summary` are read twice in one SSR render and deduped through `@mvp/data`.
- Optimizer report currently flags static/SSG candidates for home/product `recommendations` and product `price-panel`; this is expected as advisory output, not a verify failure.

## Open

- Coverage report generation is not currently part of the passing test path. `@vitest/coverage-v8` is installed and thresholds are configured, but local coverage mode stalled. Resolve this before claiming the requested 90% coverage proof.
- Page-level SSG/ISR build and CDN revalidation are still not fully implemented; current render strategy support is slot/data-policy level.
- CI/CD promotion, canary, rollback automation, and production readiness review generation remain follow-up phases.
- Runtime optimizer is still advisory; it does not yet rewrite manifests or open automated optimization patches.
