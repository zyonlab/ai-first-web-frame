# Ports

22 services. Verified consistent between each fragment's source default and
`infra/docker/docker-compose.yml`.

## Gateway and pages

| Port | Service | Package |
| --- | --- | --- |
| 4100 | shell gateway — the only public origin | `@mvp/shell-gateway` |
| 4101 | page-home | `@mvp/page-home` |
| 4102 | page-product (`/` redirects to `/product/123`) | `@mvp/page-product` |
| 4103 | page-trade | `@mvp/page-trade` |
| 4104 | page-markets | `@mvp/page-markets` |
| 4105 | page-portfolio | `@mvp/page-portfolio` |
| 4106 | page-vaults | `@mvp/page-vaults` |
| 4107 | page-referrals | `@mvp/page-referrals` |

## Fragment services

| Port | Fragment | Composed into |
| --- | --- | --- |
| 4201 | promotion-banner | page-home, page-product |
| 4202 | recommendation-widget | page-home, page-product |
| 4203 | market-header | page-trade |
| 4204 | order-book | page-trade |
| 4205 | order-form | page-trade |
| 4206 | trades-feed | page-trade |
| 4207 | account-bar | page-trade |
| 4208 | positions-table | page-trade |
| 4209 | open-orders | page-trade |
| 4210 | funding-bar | page-trade |
| 4211 | chart-panel | page-trade |
| 4212 | markets-table | page-markets |
| 4213 | portfolio-summary | page-portfolio |
| 4214 | pnl-chart | page-portfolio |

Also: `pnpm reports` serves `docs/reports/` on **4300** (`--port` to change).

## Allocation

Fragment ports start at 4201. `register-fragment` scans used ports and allocates the next free
one unless `--port` is given, and refuses a port already taken by a compose service. The
scaffolder does the same for the port it writes into a new `server.ts`.

`PORT` overrides the listen port at runtime for both the gateway and any fragment host.
