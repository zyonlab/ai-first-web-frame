# Your first fragment

The full loop: scaffold → implement → register → mount → verify → promote. Every command
prints a JSON envelope with a `status` field, and none of them writes anything on failure.

## 1. Scaffold

```sh
pnpm --filter @mvp/create-component start -- PricePanel --type fragment
```

PascalCase in, `fragments/price-panel/` out, **11 files**:

```
src/server.ts        src/render.ts       src/manifest.ts   src/budget.ts
src/fixtures.ts      src/render.test.ts  tests/server.test.ts
package.json         tsconfig.json       Dockerfile        README.md
```

Accept: `"status": "created"` and `files.length === 11`.

The generated unit **runs as scaffolded**: `src/server.ts` is a ~20-line adapter over
`@mvp/fragment-host`, the port is the first free value after 4201, and the Dockerfile really
builds. Never hand-roll a fragment server — `audit:deps` rule `fragment-server-not-hosted`
fails the build if you do.

> `--type ui` instead creates `packages/ui/src/<Name>/` with 8 files. Two shapes, one command.

## 2. Implement, test first

```sh
$EDITOR fragments/price-panel/src/render.test.ts   # extend first
$EDITOR fragments/price-panel/src/render.ts
pnpm --filter @mvp/fragment-price-panel test
```

`render.ts` receives `{props, ctx}` and returns `{html, assets, cache, metadata}`. Keep the
markup self-contained: a fragment's CSS ships in its own `<style data-fragment-style="...">`
block and its class names must be referenced from source, or `audit:css` counts them as unused
bytes.

## 3. Register

```sh
pnpm exec tsx scripts/register-fragment.mts \
  --name price-panel --version 0.1.0 \
  --service-url http://localhost:4203 \
  --channel canary --with-compose
```

Full flag set (from the script's own allowlist, `scripts/register-fragment.mts`):

| Flag | Notes |
| --- | --- |
| `--name` | kebab-case fragment name |
| `--version` | the version this channel should resolve to |
| `--service-url` | must parse as a URL |
| `--manifest-url` | defaults to `<service-url>/manifest` |
| `--assets-url` | optional; for a fragment that serves island JS from elsewhere |
| `--channel` | `stable` \| `canary` \| `preview` |
| `--port` | compose port; the script refuses one already in use |
| `--with-compose` | also add the service to `infra/docker/docker-compose.yml` |

Accept: `"status": "registered"`. Re-running the identical command prints
`"action": "unchanged"` — the script is idempotent.

Runtime override: `PRICE_PANEL_URL=https://…` repoints `serviceUrl`/`manifestUrl` for that
fragment without a registry write. (It does **not** move `assetsUrl` —
[F2](../known-limitations.md#f2).)

## 4. Mount into a page slot

```sh
pnpm exec tsx scripts/mount-slot.mts \
  --page page-home --slot pricePanel --fragment price-panel \
  --strategy dynamic-ssr --channel canary --timeout-ms 200
```

Full flag set (`scripts/mount-slot.mts` allowlist):

`--page` `--slot` `--fragment` `--strategy` `--channel` `--timeout-ms` `--props`
`--static-html` `--cache-policy` `--data-dependencies` `--depends-on` `--required`
`--remove` `--check` `--allow-unregistered`

- `--depends-on` orders this slot **after** another slot. `--data-dependencies` names entries
  in the page's data-source registry. See [slot scheduling](../guides/slot-scheduling.md).
- `--required` makes a failure of this slot turn the page `unhealthy` → gateway `503`.
- Mounting an unregistered fragment **fails** with `"status": "failed"` and no write. Register
  first, or pass `--allow-unregistered` to warn and proceed. `--remove` is unaffected.

Accept: `"status": "mounted"` with empty `warnings`.

A successful mount or unmount also regenerates `apps/<page>/src/fragmentSlots.gen.ts` from the
manifest. Never hand-edit that file. `mount-slot --page <page> --check` writes nothing and
verifies the generated file is still in sync; `pnpm verify:manifest-gen` does it for every page
and is part of `pnpm verify`.

## 5. Verify

```sh
pnpm verify                            # 14 gates, whole repo
pnpm verify:unit --name price-panel    # this unit builds, boots, and agrees on its version
```

Never ship with a failing audit or budget.

## 6. Promote, and roll back

```sh
pnpm exec tsx scripts/promote-fragment.mts --name price-panel
# "status":"promoted", with from/to versions

pnpm exec tsx scripts/rollback-fragment.mts --name price-panel [--to 0.1.0]
# "status":"rolled-back"
```

Promotion records the previous `stable` in the entry's `versions` history and appends to
`registry/releases.json` (append-only). Rollback without `--to` restores the version recorded
at promote time, and fails cleanly when there is no recorded target — which is the case for a
fragment that has never been promoted.

## Concurrency

All four lifecycle scripts write atomically (temp file + rename) behind a `<file>.lock`
advisory lock, with an optimistic content-hash check. If another process changed the file since
load, you get `{"status": "conflict", "retry": true}`, exit 1, and no write. Re-run the same
command.
