# runtime-gate — verify:runtime (Phase 4)

The composition-runtime gate: the plane `pnpm verify` can't see. Implements
`docs/AI_NATIVE_DEVX.md` §6.

Every trade-demo defect this cycle passed `pnpm verify` green and was only
visible in a running browser — fragment CSS not delivered, React #418, the
`ticker.ETH` symbol-switch crash, the 490px layout void. This gate turns those
into machine checks.

## Run

```bash
pnpm verify:runtime                                   # default: composed trade page
pnpm verify:runtime --url http://localhost:4103/trade/BTC
pnpm verify:runtime --json
```

Requires the target to be up (`docker compose up` or a running page service).
Exits non-zero on any failed check.

## Checks

| check | catches |
|---|---|
| `hydration-clean` | any page/console error |
| `no-react-418` | shell-wrap hydration mismatch |
| `assets-delivered` | `/_next` or `/assets` 404 (CSS/chunk not served) |
| `layout-fit` | a pane stranding content above a large void |
| `no-horizontal-overflow` | page wider than the viewport |
| `interaction:orderbook→order-form-price` | the signature shared-store flow, on pages that have one |

### `layout-fit` beyond the trade page

Only the trade page emits `[data-area]` grid cells, so `layout-fit` used to be
a no-op ("no panes measured", always passing) everywhere else. It now falls
back to measuring each `[data-fragment]` section's own rendered box — every
composed page (home/product/markets/portfolio/trade) emits `data-fragment` on
each fragment's root element, on both the success and fallback markup paths
(see any fragment's `render.ts`) — so the same void-threshold logic applies
generically. `[data-area]` wins when present (unchanged trade-page behavior);
`[data-fragment]` is the fallback plane; `RuntimeObservation.paneSource`
records which one produced a given report so a reader can tell them apart.

### `interaction:orderbook→order-form-price` on pages with no order-book

Only trade composes both order-book and order-form. Every other page reports
this check with `skipped: true` (visible in `--json` output and prefixed
`SKIP` in the console report) rather than the check being silently absent —
"not applicable to this page" is now distinguishable from "not collected".

## Pieces

- `src/checks.ts` — pure `evaluateRuntime(observations)` → verdict. Unit-tested
  against each defect class, the `[data-fragment]` fallback, and the explicit
  interaction skip (11 tests).
- `scripts/verify-runtime.mts` — the playwright driver (collects observations,
  including the `[data-area]` → `[data-fragment]` fallback measurement).
- `scripts/deploy-affected.mts --runtime [--origin <url>]` — runs this gate
  against every affected page's composed URL, derived from each page's own
  `apps/<page>/src/manifest.ts` `route` field (plus a tiny hand-kept sample
  table for dynamic segments like `:symbol`/`:id`) instead of a hand-kept
  page→URL map. A page with no derivable route/URL FAILS the deploy step —
  it is never silently skipped.

## Note

This is a **separate gate** from `pnpm verify` (which stays unit-plane and needs
no browser/stack). Run `verify:runtime` in the post-deploy / smoke CI stage
after `docker compose up`. Phase 2b will drive it per-affected-unit off the graph.
