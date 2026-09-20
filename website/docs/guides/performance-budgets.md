# Performance budgets

Every unit declares a budget. Some of those numbers are enforced by `pnpm verify`, some are
enforced only by a separate runtime gate, and some are declared and enforced nowhere. This page
says which is which, because the difference matters and the top-level claim "budgets are hard
gates" is only true of part of the schema.

## Declaring

`src/budget.ts` per unit, validated by `PerformanceBudgetSchema` with `scope` one of
`component` | `fragment` | `page` | `shell`.

```ts
export const orderBookBudget = loadDefaultBudget("fragment", "order-book");
```

## What is actually enforced

| Field | Scope | Enforced by | Part of `pnpm verify`? |
| --- | --- | --- | --- |
| `jsBytes` | component, fragment, page | `audit:bundle` | **yes** |
| `cssBytes` | fragment, page | `audit:css` | **yes** |
| `maxTTFBMs` | page | `pnpm verify:runtime` | no — needs a live URL |
| `maxLCPMs` | page | `pnpm verify:runtime` | no |
| `maxCLS` | page | `pnpm verify:runtime` | no |
| `rscPayloadBytes` | page | — | no (runtime-only, not statically measurable) |
| `maxNetworkRequests` | page | — | **no gate anywhere** |
| `maxINPMs` | page | — | **no gate anywhere** |
| `maxFragmentLatencyMs` | fragment | — | **no gate anywhere** |
| `maxRenderMs` | fragment | — | **no gate anywhere** |
| `maxMemoryMB` | fragment | — | **no gate anywhere** |

So: 2 of 11 fields gate the build, 3 more gate a separate runtime check you must run against a
running stack, and 5 are documentation. See [F11](../known-limitations.md#f11).

The bundle audit is honest about this in its own output — `reports/bundle-report.json` carries a
`notes` array saying runtime-only metrics are not gated, and an `unmeasured` list explaining each
skip.

## How the measured numbers are measured

- **Fragment `jsBytes`** — minified esbuild bundle of the fragment's client entry with `react`,
  `react-dom` and `@mvp/*` **external**. Shared vendor is charged to the consuming page, not
  billed to each fragment. A fragment with no client entry measures `0`.
- **Page `jsBytes`** — gzipped first-load client JS read from the `.next` build manifests.
- **`cssBytes`** — from source CSS, by `audit:css`, which also reports total/unused/duplicated
  bytes, global selector count and `!important` count.

## Current headroom

From the last `pnpm verify` (`reports/bundle-report.json`):

| Unit | jsBytes | Budget | Headroom |
| --- | --- | --- | --- |
| page-trade | 204,932 | 220,000 | 15,068 |
| page-home | 127,697 | 180,000 | 52,303 |
| page-product | 108,025 | 180,000 | 71,975 |
| page-referrals | 102,530 | 110,000 | **7,470** |
| page-vaults | 102,530 | 110,000 | **7,470** |
| page-markets / page-portfolio | 102,530 | 180,000 | 77,470 |

`page-referrals` and `page-vaults` have the tightest budgets and compose no fragments, so their
102 KB is framework baseline. Adding a single island to either would need a budget change.

For reference, upgrading React 18.3 → 19.3 moved page first-load JS by between −129 and +19 bytes
across the six pages that were otherwise unchanged — effectively neutral.

## When a budget fails

Shrink the client entry, move logic to SSR, or split the fragment. Raising the number in
`budget.ts` is a decision, not a fix — record why in the commit.

## Runtime gate

```sh
pnpm verify:runtime --url http://localhost:4100/trade/BTC --json
```

Checks `web-vitals-lcp`, `web-vitals-cls`, `web-vitals-ttfb` against the page budget. When a
metric cannot be collected the check reports **skip** rather than silently passing — so an absent
measurement is visible. There is no INP check, despite every page declaring `maxINPMs`.
