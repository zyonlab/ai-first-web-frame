# Installation

## Requirements

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 20+ | `@types/node` is pinned at 20.x; the services are plain Node |
| pnpm | 10.13+ | workspace protocol and the lockfile format in the repo |
| Docker | optional | one image per fragment; `infra/docker/docker-compose.yml` runs all 22 |

**pnpm only.** `npm` and `yarn` will produce a lockfile this workspace does not use. Run tools
through `pnpm exec <tool>` or `pnpm --filter <pkg> <script>`.

## Install

```sh
pnpm install
```

That is the whole setup. There is no separate bootstrap step: `pnpm test`,
`pnpm verify:manifest-gen` and `pnpm docs:test` each run `scripts/ensure-workspace-build.mts`
first, which delegates to Turborepo and builds `packages/` + `domains/` when a needed `dist/`
is missing or stale. A cold clone can therefore go straight to `pnpm test`.

## Verify the checkout

```sh
pnpm verify
```

14 gates, exit 0 when all pass, `reports/` rewritten each run. On a warm Turborepo cache this
takes roughly half a minute; cold it is a few minutes, dominated by `build`.

If a gate fails, [Troubleshooting → gates](../troubleshooting/gates.md) maps each gate to the
report it writes.

## Optional: the browser test suite

The Playwright specs are **not** part of `pnpm verify` and do not start any servers.

```sh
pnpm exec playwright install chromium   # once; ~94 MB
pnpm dev                                 # in another shell: all 22 services
pnpm e2e
```

Without the browser binary the API-only specs still pass and every browser spec fails with
`Executable doesn't exist` — that is a missing download, not a product failure.

A caveat worth knowing: if `pnpm build` runs while `pnpm dev` is serving, the dev servers are
reading `.next` directories that the build is replacing, and the suite reports nonsense.
Re-run the stack before trusting an e2e result taken around a build.

## React and Next versions

React **19.3** on Next **15.3**. One declared range repo-wide — `audit:deps` fails the build on
a peer/dependency range split for the same package name.
