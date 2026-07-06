# Performance Budget

Default budgets are defined in `packages/contracts`.

Component: 15 KB JS, 5 KB CSS, 16 ms render, 30 ms hydration, 5 MB memory.

Fragment: 30 KB JS, 10 KB CSS, 200 ms latency, 50 ms render, 20 MB memory.

Page: 180 KB JS, 50 KB CSS, 120 KB RSC payload, 20 requests, 800 ms TTFB, 2500 ms LCP, 200 ms INP, 0.1 CLS.

Shell: 80 KB JS, 20 KB CSS, 300 ms TTFB, 64 MB memory.

Use `pnpm audit:bundle` and `pnpm audit:css` to generate reports. Fix over-budget code by removing unused assets, splitting optional client islands, or lowering dependency weight.
