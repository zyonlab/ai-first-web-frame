# Performance Budget

Default budgets are defined in `packages/contracts` (`loadDefaultBudget`). Every fragment and
page declares its own ceilings in `fragments/<name>/src/budget.ts` / `apps/<name>/src/budget.ts`,
and those per-unit files ARE the enforced budget side of the gates below (the old flow that
compared a root `budget.json` against a root `stats.json` is retired — neither file exists, and
that pair is only still honored as a legacy input when explicitly present).

Component: 15 KB JS, 5 KB CSS, 16 ms render, 30 ms hydration, 5 MB memory.

Fragment: 30 KB JS, 10 KB CSS, 200 ms latency, 50 ms render, 20 MB memory.

Page: 180 KB JS, 50 KB CSS, 120 KB RSC payload, 20 requests, 800 ms TTFB, 2500 ms LCP, 200 ms INP, 0.1 CLS.

Shell: 80 KB JS, 20 KB CSS, 300 ms TTFB, 64 MB memory.

## How the gates measure (hard gates in `pnpm verify`)

- `pnpm audit:bundle` (`tools/bundle-budget-check`) gates `jsBytes`:
  - **Pages**: gzipped first-load client JS from the real `next build` output
    (`.next/app-build-manifest.json` route files + `build-manifest.json` `rootMainFiles`;
    route handlers, `/_not-found` and polyfills excluded). `.next` is generated, so
    `pnpm verify` runs `pnpm build` before this audit; a standalone `pnpm audit:bundle`
    on an unbuilt tree fails loudly per page instead of passing on nothing.
  - **Fragments**: minified bytes of the fragment's own client entry
    (`src/island.browser.ts` > `src/client.ts` > `src/island.tsx`), esbuild-bundled with
    `react`, `react-dom` and `@mvp/*` external — shared vendor is charged to the consuming
    page's first-load number, only fragment-owned island/patch glue is charged to the
    fragment. SSR-only fragments are reported as 0 with an explicit note.
- `pnpm audit:css` (`tools/css-budget-check`) gates `cssBytes` per unit: the unit's own
  source `.css` files, minified (lightningcss), summed — plus the repo-wide hygiene metrics
  (duplicated rules, global selectors, `!important`, unused bytes) it always measured.
- Both reports (`reports/bundle-report.*`, `reports/css-report.*`) list what was NOT
  measured instead of silently passing it: page `cssBytes` when the build emits no
  extracted `.css` asset (this repo inlines page styles), inline SSR `<script>`/`<style>`
  content, and runtime-only metrics (RSC payload, TTFB/LCP/INP/CLS, render/memory), which
  need the runtime/e2e plane.

Fix over-budget code by removing unused assets, splitting optional client islands, or lowering
dependency weight — not by editing the ceiling. If a ceiling itself is wrong (it was written
before the gates were real), correct it in the unit's `budget.ts` with an in-file comment
citing the measured baseline, as `apps/page-trade`, `apps/page-vaults` and
`apps/page-referrals` do.
