# Troubleshooting: runtime

## A slot renders its fallback

Read the slot result, which distinguishes the cases:

| `status` | `source` | Meaning |
| --- | --- | --- |
| `fallback` | `fallback` | the fragment's own render failed or timed out |
| `skipped-dependency` | `fallback` | something it depends on failed, so it was never attempted |
| `ok` | `cache` | served from the in-process cache, not the network |

Then, in order:

1. Is the service up? `curl localhost:<port>/health`.
2. Does the registry resolve the channel the slot asks for?
   `curl -s localhost:4100/manifest/fragments | jq '.fragments["<name>"]'` — this reflects env
   overrides, so it answers "which URL will actually be called".
3. Is the slot's `channel` present on that fragment? A slot pointing at a channel the fragment
   does not have resolves to the fallback **quietly** — there is no build-time check for it. 12 of
   the 14 fragments have only `canary`.
4. Timeout? Compare the slot's `timeoutMs` against the fragment's real latency.

## The page returns 503

A **required** slot failed. The body is still the degraded page — read the marker:

```sh
curl -s localhost:4100/trade/BTC | grep -o 'data-mvp-page-health="[^"]*"'
curl -s localhost:4100/trade/BTC | grep -o 'data-failed-slots="[^"]*"'
```

`SHELL_REQUIRED_FAILURE_STATUS=0` disables the translation if you need the upstream status back.

## An island does not hydrate

This is usually the handshake working, not a bug. Install a handler and read the reason:

```ts
configureIslandRuntime({ onSnapshotMismatch: (info) => console.warn(info) });
// {island, expected, actual, reason}
```

| Reason | Fix |
| --- | --- |
| `version-mismatch` | the deployed fragment version ≠ the version the page registered |
| `contract-hash-mismatch` | payload contract changed under the same version — bump the version |
| `invalid-snapshot` | the inline JSON does not satisfy `IslandSnapshotSchema` |
| `invalid-props` | the snapshot's props fail the island's `propsSchema` — usually a newly required prop that older SSR output does not carry |

Adding a required field to an island's `propsSchema` is a breaking change for every older
fragment build. Roll the fragment first, or make the field optional with a default.

## A live panel never receives a frame

1. Does the SSR node exist and lack `data-fallback`? The driver skips a fallback node on purpose.
2. Is the panel in the page's panel array?
3. Does the resolved source id exist? `resolveSourceTemplate` **throws** on a missing bound
   parameter rather than subscribing to an id containing a literal `<symbol>` — if you see that
   error, the page is not supplying a parameter the fragment declared.
4. Is the template a real source id? `apps/page-trade/src/liveContract.test.ts` fails the build for
   a template that does not parse, which catches typos like `book.12.<symbol>` before runtime.

## Rows disappear on a symbol switch

Expected for `order-book` and `trades-feed` — they bind `<symbol>`, so they are marked
`remounted` and rebuild. If `positions-table` also cleared, something gave it a parameterised
subscription; `positions` must stay parameter-free, which is precisely what keeps its rows.

## Traces

Every `/render` opens a span; `traceId` comes from `ctx.traceId` or is generated. Export is
fire-and-forget so a slow sink never blocks a response. Configure with `TRACE_SAMPLE_RATE` and the
exporters in `@mvp/observability` (OTLP JSON, file, console). Trace snapshots under
`reports/traces/` are what `audit:optimizer` reads — with none present, its scheduler hints have
nothing to work from.

## Metrics

`GET /metrics` on the gateway and on every fragment, Prometheus text format. HTTP metrics come
from `createHttpMetrics`; `recordWebVital` accepts client-reported vitals.

## Ordinary things that look like bugs

- **A `<meta>` you rendered inside `<body>` appears in `<head>`.** React 19 hoists document
  metadata. Intended.
- **`reports/` changed after `pnpm verify`.** It is machine output, rewritten every run.
  `docs/reports/` is the hand-written one.
- **e2e results are nonsense.** Did `pnpm build` run while `pnpm dev` was serving? Restart the
  stack.
- **`pnpm e2e` fails every browser spec with "Executable doesn't exist".** `pnpm exec playwright
  install chromium`.
