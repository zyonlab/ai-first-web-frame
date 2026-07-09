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
| `interaction:orderbook→order-form-price` | the signature shared-store flow |

## Pieces

- `src/checks.ts` — pure `evaluateRuntime(observations)` → verdict. Unit-tested
  against each defect class (6 tests).
- `scripts/verify-runtime.mts` — the playwright driver (collects observations).

## Note

This is a **separate gate** from `pnpm verify` (which stays unit-plane and needs
no browser/stack). Run `verify:runtime` in the post-deploy / smoke CI stage
after `docker compose up`. Phase 2b will drive it per-affected-unit off the graph.
