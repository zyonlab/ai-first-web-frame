# Architecture

The MVP is a pnpm monorepo with independent deployable units: one shell
gateway, 7 Next.js page apps (4101-4107), and 14 SSR fragment services
(4201-4214), composed through two registries.

Request flow:

```mermaid
flowchart TD
  A["CDN / Ingress"] --> B["apps/shell-gateway :4100"]
  B --> C["@mvp/routes (route registry, packages/routes/src/registry.ts)"]
  C --> D["7 page apps :4101-4107<br/>page-home :4101 · page-product :4102 · page-trade :4103<br/>page-markets :4104 · page-portfolio :4105 · page-vaults :4106 · page-referrals :4107"]
  D --> E["@mvp/registry (fragment registry, registry/registry.data.json)"]
  E --> F["14 fragment services :4201-4214<br/>promotion-banner :4201 · recommendation-widget :4202 · market-header :4203<br/>order-book :4204 · order-form :4205 · trades-feed :4206 · account-bar :4207<br/>positions-table :4208 · open-orders :4209 · funding-bar :4210 · chart-panel :4211<br/>markets-table :4212 · portfolio-summary :4213 · pnl-chart :4214"]
```

Shell Gateway creates request context, resolves routes through `@mvp/routes`,
forwards trace headers, applies fallback behavior, and owns global security
headers.

Page apps own SEO content, metadata, page manifests
(`src/manifest.slots.json`), and fragment slot composition. SEO-critical
content is rendered in the initial HTML.

Business fragments are SSR services with `/health`, `/metrics`, `/manifest`,
`/assets`, and `/render`. A fragment failure returns fallback HTML and does
not break page rendering.

Code is layered three ways, with imports flowing strictly downward:

- `apps/` + `fragments/` — deployable units (may import domains and packages).
- `domains/` — demo domain layer (trade-contracts, trade-data, trade-prefs,
  trade-theme, trade-chart); may import packages only.
- `packages/` — domain-agnostic `@mvp/*` framework libraries (contracts,
  runtime composition, request context, data, interaction, observability,
  design tokens, server-safe UI, ...); never import upward.
