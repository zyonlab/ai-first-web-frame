# CLI reference

Flag lists below are the scripts' own allowlists (`unknownFlagError`), not prose. An unknown flag
is rejected with a `did you mean --<flag>?` suggestion, `{"status":"failed"}`, exit 1, no write.

## Lifecycle

### `register-fragment`

```sh
pnpm exec tsx scripts/register-fragment.mts --name <kebab> --version <semver> \
  --service-url <url> [--manifest-url <url>] [--assets-url <url>] \
  [--channel stable|canary|preview] [--port <n>] [--with-compose]
```

Statuses: `registered` · `conflict` · `failed`. Idempotent — an identical re-run reports
`"action": "unchanged"`.

### `mount-slot`

```sh
pnpm exec tsx scripts/mount-slot.mts --page <page> --slot <name> \
  [--fragment <kebab>] [--strategy static|ttl-cache|cached-ssr|dynamic-ssr] \
  [--channel <channel>] [--timeout-ms <n>] [--props <json>] [--static-html <html>] \
  [--cache-policy <json>] [--data-dependencies <json-array>] [--depends-on <json-array>] \
  [--required] [--remove] [--check] [--allow-unregistered]
```

Statuses: `mounted` · `conflict` · `failed`. `--remove` unmounts. `--check` writes nothing and
verifies `fragmentSlots.gen.ts` is in sync. Mounting an unregistered fragment fails unless
`--allow-unregistered`.

### `promote-fragment`

```sh
pnpm exec tsx scripts/promote-fragment.mts --name <kebab>
```

Statuses: `promoted` · `unchanged` · `conflict` · `failed`. Records the previous `stable` in
`versions` and appends to `registry/releases.json`.

### `rollback-fragment`

```sh
pnpm exec tsx scripts/rollback-fragment.mts --name <kebab> [--to <version>]
```

Statuses: `rolled-back` · `unchanged` · `conflict` · `failed`. Fails cleanly with no recorded
target.

> Shorter aliases exist — `pnpm register:fragment`, `pnpm mount:slot`, `pnpm promote:fragment`,
> `pnpm rollback:fragment` — and take the same flags after `--`.

## Verification

| Command | What it does |
| --- | --- |
| `pnpm verify` | the 14 gates; writes `reports/`; exit 1 if any fails |
| `pnpm verify:unit --name <f> [--port] [--filter] [--skip-build]` | build + boot + version contract for one unit |
| `pnpm verify:manifest-gen [--page <p>] [--check]` | slot codegen freshness; statuses `fresh` · `stale` · `exempt` · `failed` |
| `pnpm verify:demos [--check] [--write]` | `docs/DEMOS.md` generated block vs each page manifest's `demonstrates` |
| `pnpm verify:runtime --url <url> [--json]` | web-vitals checks against a **running** page |
| `pnpm docs:test [--config] [--reporter]` | executes AGENT.md fenced blocks |
| `pnpm typecheck` | tsgo across 54 projects; writes `reports/typecheck-report.json` |
| `pnpm lint` / `pnpm check` / `pnpm format` | oxlint / biome check / biome write |

## Audits

```sh
pnpm audit:similarity   pnpm audit:bundle   pnpm audit:css
pnpm audit:deps         pnpm audit:optimizer pnpm audit:boundary
```

Each writes a JSON + Markdown report into `reports/`. Rule codes:
[diagnostics](diagnostics.md).

## Graph and release tooling

| Command | Notes |
| --- | --- |
| `pnpm graph` | query the unit graph. Flags: `--kind` `--name` `--dependents-of` `--dependencies-of` `--consumes` `--consumes-slice` `--produces-slice` `--json` |
| `pnpm affected:graph` | affected plan for a diff. Flags: `--base` `--head` `--json` `--name-only` `--github-output` `--quiet` `--verify` |
| `pnpm deploy:affected` | Flags: `--base` `--dry-run` `--origin` `--runtime` `--url` |
| `pnpm smoke` | docker stack smoke. Flags: `--host` `--interval` `--timeout` `--help` |

## Development

| Command | Notes |
| --- | --- |
| `pnpm dev` | all 22 services in parallel |
| `pnpm --filter <pkg> dev` | one service — use this; dedicated `dev:*` scripts exist for only 4 units |
| `pnpm dev:component [--port] [--json]` | component harness against `@mvp/ui` fixtures |
| `pnpm reports [--port n] [--open]` | serve `docs/reports/` (default 4300) |
| `pnpm mcp` | start the MCP server |
| `pnpm e2e` | Playwright; needs the stack already running |

## Conventions shared by all lifecycle scripts

- JSON envelope on stdout with a `status` field.
- Exit 1 on failure, and **nothing written**.
- Atomic write (temp + rename) behind a `<file>.lock` advisory lock with an optimistic
  content-hash check. On a concurrent change: `{"status":"conflict","retry":true}` — re-run the
  same command.
