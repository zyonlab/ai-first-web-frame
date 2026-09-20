# Quick start

Bring up the whole composition and look at it.

## Start everything

```sh
pnpm install
pnpm dev
```

`pnpm dev` is `pnpm -r --parallel --filter './apps/*' --filter './fragments/*' dev` — all 22
services at once. The fragment services answer in a second or two; the Next.js page apps
compile on first request, so the first hit on a page is slow.

| URL | What it is |
| --- | --- |
| `http://localhost:4100/` | shell gateway — the only origin a browser should use |
| `http://localhost:4100/trade/BTC` | the richest page: 9 slots, islands, realtime panels |
| `http://localhost:4100/product/123` | static + ISR + dynamic slots in one page |
| `http://localhost:4100/manifest/fragments` | the resolved fragment registry, as JSON |
| `http://localhost:4100/manifest/routes` | the route registry |
| `http://localhost:4201/` | a fragment service's own landing page, with its live links |

There is a dedicated script for only some units (`dev:shell`, `dev:page-home`,
`dev:page-product`, `dev:fragment:promotion-banner`, `dev:fragment:recommendation-widget`).
For anything else use the filter directly:

```sh
pnpm --filter @mvp/page-trade dev
pnpm --filter @mvp/fragment-order-book dev
```

## Look at one fragment in isolation

Every fragment serves the same eight routes, so you can exercise one without a page:

```sh
curl -s localhost:4204/health    | jq   # {status,service,version,uptimeMs}
curl -s localhost:4204/manifest  | jq   # the manifest verbatim
curl -s localhost:4204/budget    | jq   # its performance budget
curl -s localhost:4204/assets    | jq   # manifest.assets
```

`POST /render` takes `{ctx, props}` and answers `{html, assets, cache, metadata}`:

```sh
curl -s localhost:4204/render -X POST -H 'content-type: application/json' \
  -d '{"props":{"symbol":"BTC"},"ctx":{"locale":"en-US","tenant":"default"}}' | jq 'del(.html)'
# { "assets": {...}, "cache": {"ttl":0,"tags":["book","book:BTC"]},
#   "metadata": {"name":"order-book","version":"0.1.0"} }
```

That `ctx` is **not** a complete `RequestContext` — the full schema also requires `traceId`,
`requestId`, `featureFlags` and `timestamp`. It works anyway because
`parseFragmentRenderRequest` is two-tier: it tries the strict schema, then falls back to a
lenient envelope (`ctx` partial and optional) and only answers `400` when both fail. Handy for
poking at a service by hand; see [known limitations F14](../known-limitations.md#f14) for why
you cannot currently tell whether *production* traffic is hitting the lenient tier.

`4204` is `order-book`. The full port map is in [reference/ports](../reference/ports.md).

## Prove a fragment ships on its own

```sh
pnpm verify:unit --name order-book
```

Builds only that unit's dependency closure, boots `dist/server.js`, and asserts `/health`,
`/ready` and `/manifest` agree on the manifest version and that `POST /render` output carries
it. Exit 0 only if every step passed.

## See what the page actually did

Each composed page can expose its scheduler trace. The gateway also carries trace headers on
the composed response:

```sh
curl -sI localhost:4100/trade/BTC | grep -i trace
```

Diagnostics rendering is gated by `MVP_DIAGNOSTICS` (see
[environment variables](../reference/environment-variables.md)).

## Read the reports

```sh
pnpm verify      # writes reports/
pnpm reports     # serves docs/reports/ on :4300 — long-form HTML reports about the repo itself
```

`reports/` (repo root) is machine output, rewritten by every `pnpm verify`.
`docs/reports/` is hand-written analysis. They are different directories on purpose.

## Next

- [Your first fragment](your-first-fragment.md) — the full scaffold → ship loop.
- [AI setup](ai-setup.md) — driving all of this from an agent.
