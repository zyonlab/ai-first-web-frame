# Environment variables

Every variable below was traced to the code that reads it. Variables declared in `turbo.json` but
read nowhere are listed at the bottom rather than silently omitted.

## Runtime

| Variable | Read by | Effect |
| --- | --- | --- |
| `PORT` | `apps/shell-gateway/src/server.ts`, `packages/fragment-host/src/index.ts` | listen port override |
| `PUBLIC_SITE_ORIGIN` | `apps/shell-gateway/src/server.ts` | canonical origin for `robots.txt`, `sitemap.xml` and SEO metadata |
| `TRACE_SAMPLE_RATE` | `apps/shell-gateway/src/observability.ts`, `packages/fragment-host/src/index.ts` | trace sampling |
| `MVP_DIAGNOSTICS` | `packages/runtime/src/seo.ts` (`isDiagnosticsEnabled`) | `on` enables diagnostics rendering in production |
| `SHELL_PAGE_TIMEOUT_MS` | gateway | upstream page fetch timeout |
| `SHELL_ASSET_TIMEOUT_MS` | gateway | asset passthrough timeout |
| `SHELL_FRAGMENT_PROXY_TIMEOUT_MS` | gateway | `/_fragment/*` proxy timeout |
| `SHELL_REQUIRED_FAILURE_STATUS` | gateway | status for a failed required slot; `0` keeps the upstream status |
| `RECENTLY_VIEWED_COOKIE_SECRET` | `apps/page-product/src/recentlyViewed.ts` | signs the recently-viewed cookie |

## Fragment targeting

| Pattern | Effect |
| --- | --- |
| `<FRAGMENT_NAME>_URL` | overrides that fragment's `serviceUrl` and `manifestUrl` at registry load |

The name is uppercased with non-alphanumerics replaced (`fragmentEnvVarName`): `order-book` →
`ORDER_BOOK_URL`, `price-panel` → `PRICE_PANEL_URL`.

The value must parse as a URL — `FragmentRegistryEntrySchema.shape.serviceUrl` validates it, and a
bad value throws at load naming the offending variable rather than failing later at fetch time.

It does **not** override `assetsUrl` ([F2](../known-limitations.md#f2)).

## Tooling and CI

| Variable | Read by | Effect |
| --- | --- | --- |
| `NODE_ENV` | `apps/page-trade/tsdown.vendor.config.ts` | vendor bundle mode |
| `E2E_STRICT` | `e2e/support/expect-fragment-content.ts` | require real fragment content instead of accepting a fallback |
| `DOCS_TEST_DEBUG` | `scripts/docs-test.mts` | verbose output |
| `DOCS_TEST_KEEP_TMP` | `scripts/docs-test.mts` | keep the scratch dir for inspection |
| `SHELL_URL` | `scripts/deploy-affected.mts` | target for the affected deploy plan |
| `CI` | various | CI-mode behaviour |

## Turborepo classification

`turbo.json` splits them deliberately, and Biome's `noUndeclaredEnvVars` enforces that a variable
the code reads is declared:

- **`globalEnv`** — values that change *what a task does*, so they belong in the cache key:
  `NODE_ENV`, `CI`, `MVP_DIAGNOSTICS`, `PUBLIC_SITE_ORIGIN`, `TRACE_SAMPLE_RATE`, the four
  `SHELL_*` settings, `E2E_STRICT`, `DOCS_TEST_DEBUG`, `DOCS_TEST_KEEP_TMP`.
- **`globalPassThroughEnv`** — values that only address an external environment, so they must
  **not** enter a cache key: `SHELL_URL`, `PAGE_*_URL`, `*_URL`,
  `RECENTLY_VIEWED_COOKIE_SECRET`.

Getting this wrong is a correctness bug, not a style choice: a secret in `globalEnv` would make
the cache key change whenever the secret rotates, and a behaviour flag in
`globalPassThroughEnv` would serve a stale cached pass.

## Declared but unread

`REGISTRY_URL`, `REGISTRY_USERNAME`, `REGISTRY_PASSWORD` appear in `globalPassThroughEnv` and are
read nowhere in the repository. They are leftovers, not a supported integration point
([F3](../known-limitations.md#f3)).
