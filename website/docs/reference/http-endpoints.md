# HTTP endpoints

## Fragment service — 8 routes

Every one of the 14 fragments serves exactly these, because they come from
`@mvp/fragment-host` rather than from each service.

| Method | Path | Response |
| --- | --- | --- |
| GET | `/` | HTML index of the service's own endpoints plus one live sample render |
| GET | `/health` | `{status:"ok", service, version, uptimeMs}` |
| GET | `/ready` | identical payload to `/health` |
| GET | `/metrics` | Prometheus text (`PROMETHEUS_CONTENT_TYPE`) |
| GET | `/manifest` | the fragment manifest, verbatim |
| GET | `/assets` | `manifest.assets` |
| GET | `/budget` | the unit's performance budget |
| POST | `/render` | `{html, assets, cache, metadata}` |

`version` in `/health` is the **deployed manifest version** — that is what lets a rollout assert
which build answered before promoting a channel.

`/health` and `/ready` are the same handler. There is no distinction between liveness and
readiness in this host; if you need one, that is a gap to close, not a subtlety to discover.

### `POST /render`

Request `{ctx, props}`. Two-tier validation: strict `FragmentRenderRequestSchema`, then a lenient
envelope with `ctx` partial and optional, then `400`:

```json
{ "error": { "code": "invalid-render-request", "issues": [ … ] } }
```

Response:

```json
{
  "html": "<style data-fragment-style=\"order-book\">…</style>…",
  "assets": { "js": ["/assets/order-book.client.js"], "css": ["/assets/order-book.css"] },
  "cache":  { "ttl": 0, "tags": ["book", "book:BTC"] },
  "metadata": { "name": "order-book", "version": "0.1.0" }
}
```

A fragment may add routes via `extraRoutes`, but the eight above are fixed.

## Shell gateway — the public origin

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | gateway liveness |
| GET | `/metrics` | Prometheus text |
| GET | `/robots.txt` | generated from the site origin |
| GET | `/sitemap.xml` | generated from the route registry |
| GET | `/manifest/routes` | the route registry, as JSON |
| GET | `/manifest/fragments` | the **resolved** fragment registry (env overrides applied) |
| GET | `/_shell/theme` | theme selection endpoint |
| GET | `/_shell/locale` | locale selection endpoint |
| ALL | `/_fragment/<fragment>/<target>/*` | fragment backend proxy |
| GET | `/_next/*` | Next.js asset passthrough |
| GET | `/*` | route resolution → proxy to the owning page app |

`/manifest/fragments` is the fastest way to see what a running gateway believes: it reflects
`registry/registry.data.json` **after** `<FRAGMENT>_URL` overrides are applied, so it answers
"which service will this slot actually call".

Timeouts: `SHELL_PAGE_TIMEOUT_MS`, `SHELL_ASSET_TIMEOUT_MS`,
`SHELL_FRAGMENT_PROXY_TIMEOUT_MS`. Required-slot failure → status:
`SHELL_REQUIRED_FAILURE_STATUS` (`0` disables).
