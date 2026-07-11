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

### Strict content mode (`E2E_STRICT`)

Fallback isolation is intentional framework behavior: when a fragment
service is unreachable, the composing page still returns 200 with degraded
markup (`data-fallback="true"` on the fragment's root element) instead of
failing. `e2e/shell-home.spec.ts` and `e2e/shell-product.spec.ts` therefore
accept either live fragment content or its SSR fallback by default — a
fully-degraded page (every fragment down) is documented, passing behavior.

Set `E2E_STRICT=1` to switch those same assertions to a strict tier that
requires live content only; a fallback then fails the test. Use this when
you want e2e to prove the full fragment stack is actually healthy, e.g.:

```sh
E2E_STRICT=1 pnpm e2e --project=chromium
```

The toggle is implemented once, in
`e2e/support/expect-fragment-content.ts`'s `expectFragmentContent(locator,
{ live, fallback })` helper, and consumed by both specs above — it is not
forked per spec.

## Conventions

- Playwright specs are `e2e/*.spec.ts`. Vitest unit tests may live under
  `e2e/unit/**/*.test.ts` and are excluded via `testMatch`.
- Anchor assertions on stable contracts (`data-page`, `data-fragment`,
  `data-request-trace`, the `x-trace-id` shell header, `/health`, `/manifest`,
  route status codes), not on styling or demo copy that changes between waves.
  Note: the shell is a transparent proxy, so composed pages carry no injected
  chrome marker — assert the page's own `data-page`/content instead.
