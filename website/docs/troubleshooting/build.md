# Troubleshooting: build

## `pnpm build` is slow

It should not be, twice. `build` and `test` run through Turborepo (`turbo.json`); a warm tree
takes `pnpm verify` from roughly 165s to 32s, and Turborepo restores deleted `dist/` and `.next/`
directories from cache rather than rebuilding them.

If everything rebuilds every time, something is invalidating the cache. The two rules:

1. **Anything a task reads from outside its own package must be declared**, or the cache serves a
   stale pass. `packages/mcp/turbo.json` is the worked example — its tests read the registry data
   and page manifests, so those are listed as `$TURBO_ROOT$` inputs.
2. **Env vars that change what a task does belong in `globalEnv`**; values that only address an
   external environment (`*_URL`, secrets) belong in `globalPassThroughEnv` so they never enter a
   cache key.

A change to any `globalDependencies` entry (`pnpm-lock.yaml`, root `package.json`,
`tsconfig.base.json`, `vitest.config.ts`, `biome.json`, `oxlint.json`, `dependency-audit.json`)
invalidates everything by design.

## Module not found for a `@mvp/*` package

The package's `dist/` is missing or stale. Run `pnpm build`. Do not import from `src/` to work
around it — package exports point at `dist/` on purpose.

If it happens on a fresh clone during `pnpm test`, the prerequisite build should have handled it;
read the build error rather than the test error.

## A new export subpath is not resolvable in tests

Vitest aliases are derived from each package's `exports` map by
`scripts/workspaceAliases.mts`. The generator reads the export **target**, not the subpath name —
`@mvp/fragment-order-book/patch` maps to `src/ladder.ts`, so guessing `src/patch.ts` from the name
would be wrong. Add the subpath to `package.json` `exports` and the alias follows; nothing needs
hand-editing.

## `next build` fails only in one page app

Page apps are separate deployables with their own `tsconfig.json`. Build just that one:

```sh
pnpm --filter @mvp/page-trade build
```

## tsgo vs tsc

`pnpm typecheck` uses tsgo over per-project tsconfigs and writes
`reports/typecheck-report.json` with a result per project. `pnpm typecheck:legacy` (`tsc -b`) is
kept as a fallback for when a tsgo diagnostic is unclear — expect it to be slower and to
occasionally disagree at the margins.

## Docker

```sh
docker compose -f infra/docker/docker-compose.yml config   # validate after registering a fragment
docker compose -f infra/docker/docker-compose.yml up
pnpm smoke                                                  # health-check the running stack
```

One Dockerfile per fragment. `register-fragment --with-compose` adds the service and refuses a
port already in use; pass an explicit free `--port` if it does.

## The browser vendor bundle

`page-trade` builds a self-hosted vendor bundle for the island-over-import-map spike:

```sh
pnpm --filter @mvp/page-trade build:spike-vendor
```

Output lands in `apps/page-trade/public/spike-vendor/` (gitignored, built on demand). It bundles
`react`, `react-dom/client`, `react/jsx-runtime`, `@mvp/trade-contracts` and `@mvp/ui/shadcn` from
`node_modules`, so it tracks whatever React version is installed. Nothing is fetched from a CDN.
