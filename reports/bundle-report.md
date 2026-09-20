# Bundle Budget Report

Status: pass

| Scope | Unit | Metric | Actual | Budget | Status | Detail |
| --- | --- | --- | --- | --- | --- | --- |
| fragment | account-bar | jsBytes | 3091 | 8000 | pass | esbuild bundle of fragments/account-bar/src/island.tsx (react/@mvp externals), minified bytes |
| fragment | chart-panel | jsBytes | 5858 | 30000 | pass | esbuild bundle of fragments/chart-panel/src/island.tsx (react/@mvp externals), minified bytes |
| fragment | funding-bar | jsBytes | 0 | 2000 | pass | inline SSR <script> content, if any, is not counted |
| fragment | market-header | jsBytes | 4294 | 8000 | pass | esbuild bundle of fragments/market-header/src/island.tsx (react/@mvp externals), minified bytes |
| fragment | markets-table | jsBytes | 0 | 2000 | pass | inline SSR <script> content, if any, is not counted |
| fragment | open-orders | jsBytes | 0 | 30000 | pass | inline SSR <script> content, if any, is not counted |
| fragment | order-book | jsBytes | 2575 | 30000 | pass | esbuild bundle of fragments/order-book/src/client.ts (react/@mvp externals), minified bytes |
| fragment | order-form | jsBytes | 5154 | 30000 | pass | esbuild bundle of fragments/order-form/src/island.browser.ts (react/@mvp externals), minified bytes |
| fragment | pnl-chart | jsBytes | 0 | 2000 | pass | inline SSR <script> content, if any, is not counted |
| fragment | portfolio-summary | jsBytes | 0 | 0 | pass | inline SSR <script> content, if any, is not counted |
| fragment | positions-table | jsBytes | 0 | 30000 | pass | inline SSR <script> content, if any, is not counted |
| fragment | promotion-banner | jsBytes | 0 | 30000 | pass | inline SSR <script> content, if any, is not counted |
| fragment | recommendation-widget | jsBytes | 0 | 30000 | pass | inline SSR <script> content, if any, is not counted |
| fragment | trades-feed | jsBytes | 0 | 30000 | pass | inline SSR <script> content, if any, is not counted |
| page | page-home | jsBytes | 127713 | 180000 | pass | Next first-load JS (.next manifests), gzipped bytes |
| page | page-markets | jsBytes | 102530 | 180000 | pass | Next first-load JS (.next manifests), gzipped bytes |
| page | page-portfolio | jsBytes | 102530 | 180000 | pass | Next first-load JS (.next manifests), gzipped bytes |
| page | page-product | jsBytes | 108025 | 180000 | pass | Next first-load JS (.next manifests), gzipped bytes |
| page | page-referrals | jsBytes | 102530 | 110000 | pass | Next first-load JS (.next manifests), gzipped bytes |
| page | page-trade | jsBytes | 204945 | 220000 | pass | Next first-load JS (.next manifests), gzipped bytes |
| page | page-vaults | jsBytes | 102530 | 110000 | pass | Next first-load JS (.next manifests), gzipped bytes |

## Not measured by this audit

| Unit | Metric | Reason |
| --- | --- | --- |
| account-bar | cssBytes | enforced by css-budget-check (pnpm audit:css) |
| chart-panel | cssBytes | enforced by css-budget-check (pnpm audit:css) |
| funding-bar | cssBytes | enforced by css-budget-check (pnpm audit:css) |
| market-header | cssBytes | enforced by css-budget-check (pnpm audit:css) |
| markets-table | cssBytes | enforced by css-budget-check (pnpm audit:css) |
| open-orders | cssBytes | enforced by css-budget-check (pnpm audit:css) |
| order-book | cssBytes | enforced by css-budget-check (pnpm audit:css) |
| order-form | cssBytes | enforced by css-budget-check (pnpm audit:css) |
| pnl-chart | cssBytes | enforced by css-budget-check (pnpm audit:css) |
| portfolio-summary | cssBytes | enforced by css-budget-check (pnpm audit:css) |
| positions-table | cssBytes | enforced by css-budget-check (pnpm audit:css) |
| promotion-banner | cssBytes | enforced by css-budget-check (pnpm audit:css) |
| recommendation-widget | cssBytes | enforced by css-budget-check (pnpm audit:css) |
| trades-feed | cssBytes | enforced by css-budget-check (pnpm audit:css) |
| page-home | cssBytes | build emits no extracted .css asset (page styles are inline-injected); not gated here |
| page-markets | cssBytes | build emits no extracted .css asset (page styles are inline-injected); not gated here |
| page-portfolio | cssBytes | build emits no extracted .css asset (page styles are inline-injected); not gated here |
| page-product | cssBytes | build emits no extracted .css asset (page styles are inline-injected); not gated here |
| page-referrals | cssBytes | build emits no extracted .css asset (page styles are inline-injected); not gated here |
| page-trade | cssBytes | build emits no extracted .css asset (page styles are inline-injected); not gated here |
| page-vaults | cssBytes | build emits no extracted .css asset (page styles are inline-injected); not gated here |

- Fragment jsBytes = minified esbuild bundle of the fragment's client entry with react/react-dom/@mvp/* external (shared vendor is charged to the consuming page).
- Page jsBytes = gzipped first-load client JS from the .next build manifests.
- Fragment cssBytes ceilings are enforced by css-budget-check (pnpm audit:css), not here.
- Runtime-only budget metrics (rscPayloadBytes, TTFB/LCP/INP/CLS, render/memory) are not statically measurable and are not gated by this audit.
