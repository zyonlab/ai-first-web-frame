# End-to-end tests

Playwright specs that validate the composed demo against its stable
contracts: shell markers, route status codes, fragment `/health` and
`/render` endpoints, fragment slot content (or SSR fallback), and no-JS
readability.

## Prerequisites

The suite does not start any servers. All five demo services must be
listening before you run it:

| Port | Service |
| ---- | ------- |
| 4100 | shell-gateway (composed pages, `baseURL`) |
| 4101 | page-home (standalone Next.js app) |
| 4102 | page-product (standalone Next.js app, `/` redirects to `/product/123`) |
| 4201 | promotion-banner fragment service |
| 4202 | recommendation-widget fragment service |

Start them either way:

```sh
# local dev servers (all apps + fragments)
pnpm dev

# or the production-like container stack
docker compose -f infra/docker/docker-compose.yml up
```

In CI the docker smoke script is responsible for bringing the stack up
before invoking Playwright.

## Running

```sh
pnpm e2e                      # both projects: chromium + no-js
pnpm e2e --project=chromium   # JS-enabled browser only
pnpm e2e --project=no-js      # SSR/no-JS semantics only
pnpm exec playwright test --list
```

The `no-js` project runs the browser specs with `javaScriptEnabled: false`
to prove the pages are fully server-rendered; API-only contract specs
(`fragments-api.spec.ts`) run once in the chromium project.

Reports are written to `reports/playwright`.

## Conventions

- Playwright specs are `e2e/*.spec.ts`. Vitest unit tests may live under
  `e2e/unit/**/*.test.ts` and are excluded via `testMatch`.
- Anchor assertions on stable contracts (`data-shell-gateway`,
  `data-fragment`, `data-request-trace`, `/health`, `/manifest`, route
  status codes), not on styling or demo copy that changes between waves.
