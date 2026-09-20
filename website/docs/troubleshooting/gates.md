# Troubleshooting: verification gates

`pnpm verify` runs 14 gates **sequentially** and writes `reports/verify-report.json`. Read the
per-gate report, not just the exit code.

| Gate | Timeout | Report | First thing to check |
| --- | --- | --- | --- |
| `typecheck` | 60s | `typecheck-report.json` | which of the 54 projects failed |
| `lint` | 60s | — | oxlint output |
| `check` | 60s | — | biome; `pnpm exec biome check --write <file>` fixes formatting |
| `verify:manifest-gen` | 60s | — | a `stale` page → re-run `mount-slot`, never hand-edit `fragmentSlots.gen.ts` |
| `verify:demos` | 60s | — | `docs/DEMOS.md` block vs each page manifest's `demonstrates`; `--write` regenerates |
| `docs:test` | 60s | `docs-test-report.json` | which `AGENT.md` block stopped running |
| `test` | 180s | — | Vitest, via Turborepo |
| `build` | 300s | — | tsdown for packages/fragments, `next build` for pages |
| `audit:similarity` | 60s | `similarity-report.json` | `matches` over `threshold` |
| `audit:bundle` | 60s | `bundle-report.json` | `checks[].status` |
| `audit:css` | 60s | `css-report.json` | `metrics.unusedCssBytes` |
| `audit:deps` | 60s | `dependency-report.json` | `issues[].code` → [diagnostics](../reference/diagnostics.md) |
| `audit:optimizer` | 60s | `optimization-findings.json` | only `critical` fails |
| `audit:boundary` | 60s | `server-client-boundary-report.json` | `severity: "fail"` entries only |

## Specific failures

**`check` fails on formatting only.** Biome refuses to auto-fix during `check`.

```sh
pnpm exec biome check --write <paths>
```

**`duplicated-package-version`.** The same dependency is declared at two different ranges
somewhere in the workspace — including a `peerDependencies` vs `dependencies` split for the same
package. Unify the range; the repo deliberately allows exactly one per package name.

**`server-safe-browser-global`.** A `packages/*` file touches `document`/`window`/`localStorage`.
If the module really is browser-only, give it `"use client"` and consider making it a separate
export subpath so server bundles never pull it in — that is what `@mvp/runtime/live` does. Do not
add the package to a whitelist to dodge the rule.

**`fragment-server-not-hosted`.** The fragment builds its own Fastify instance. Rewrite
`src/server.ts` as an adapter over `createFragmentServer`.

**`layer-constraint-violation`.** Fix the import direction, or change `depConstraints` in
`dependency-audit.json` deliberately. Adding a tag to escape the rule is not a fix.

**`raw-fetch-in-business-code`.** Use `@mvp/request` or `@mvp/data`.

**Budget failure.** Shrink the client entry, move work to SSR, or split the fragment. Raising the
number is a decision that belongs in a commit message.

**Similarity failure.** Reuse the flagged component instead of adding a near-duplicate.

**`verify:manifest-gen` reports `stale`.** Re-run the `mount-slot` command for that page (even a
no-op `--check` tells you which page). The generated file is derived; the JSON manifest is the
source.

**`docs:test` fails.** An `AGENT.md` example no longer runs. Fix the example or the code — do not
mark the block ` no-run ` to silence it unless it genuinely cannot be executable, since the report
counts skipped blocks and the number is meant to stay at zero.

**Typecheck fails in a package you did not touch.** Report the pre-existing failure; do not patch
another package to get green.

## Cold clone

`pnpm test`, `pnpm verify:manifest-gen` and `pnpm docs:test` each run
`scripts/ensure-workspace-build.mts` first, which always delegates to Turborepo rather than
skipping when a `dist/` merely exists — a present-but-stale `dist/` is exactly the failure that
check exists to prevent. If a gate fails with a module-not-found on a `@mvp/*` package, run
`pnpm build` and read the build error; it is the real one.
