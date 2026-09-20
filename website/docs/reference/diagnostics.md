# Diagnostics

Machine-readable codes and statuses, so an agent (or a CI script) can react to a specific failure
rather than grep a log.

## `audit:deps` — 14 rule codes

Severity `fail` unless noted. Report: `reports/dependency-report.json`
(`{tool, status, issues:[{code, severity, file?, packageName?, detail}]}`).

| Code | Meaning |
| --- | --- |
| `layer-constraint-violation` | import crosses a `depConstraints` boundary in `dependency-audit.json` |
| `domain-code-in-framework-package` | business vocabulary in a `packages/*` file |
| `page-importing-another-page` | one page app imports another's code |
| `cross-page-import` | any cross-page reach |
| `fragment-importing-page-code` | a fragment imports page code, breaking independent deploy |
| `fragment-server-not-hosted` | a fragment builds its own Fastify server instead of `@mvp/fragment-host` |
| `raw-fetch-in-business-code` | bare `fetch(...)`; use `@mvp/request` / `@mvp/data` |
| `fetch-without-timeout` | a `fetch` with no abort path |
| `server-safe-browser-global` | a `packages/*` file touches `document`/`window`/`localStorage` without `"use client"` |
| `client-only-dependency-in-server` | a server file imports a client-only module |
| `island-bus-without-escape-hatch` | an island wired to the bus with no non-JS path |
| `duplicated-package-version` | the same dependency declared at two different ranges across the workspace |
| `forbidden-package` | a package on the deny list |
| `large-package` | a dependency over its size allowance |

## `audit:boundary` — 4 rule codes

Report: `reports/server-client-boundary-report.json` (`{tool, status, checkedFiles, issues}`).

| Code | Severity | Meaning |
| --- | --- | --- |
| `server-imports-client-module` | fail | server file pulls a `"use client"` module |
| `server-browser-global` | fail | server file touches a browser global |
| `page-use-client` | fail | a page component marked `"use client"` unnecessarily |
| `large-client-component` | **warn** | client component over the size guideline |

A `warn` does not fail the gate. Four `large-client-component` warnings are currently open
([F10](../known-limitations.md#f10)).

## The other four audits

They do not use rule codes; each has its own report shape.

| Audit | Report | Shape |
| --- | --- | --- |
| `audit:bundle` | `bundle-report.json` | `{tool, status, checks:[{scope, unit, metric, actual, budget, status, measurement}], unmeasured:[{unit, metric, reason}], notes:[…]}` |
| `audit:css` | `css-report.json` | `{tool, status, metrics:{totalCssBytes, unusedCssBytes, duplicatedRules, globalSelectors, importantCount, cssModuleUsage}, budget, checks, findings}` |
| `audit:similarity` | `similarity-report.json` | `{tool, status, threshold, checkedFiles, matches}` |
| `audit:optimizer` | `optimization-findings.json` | `{tool, status, findings:[{id, severity, category, target, message, location, evidence, recommendation}], traces}` |

The `unmeasured` array in the bundle report is worth reading: it names every budget field that was
**not** checked and why, which is how you find out that a declared ceiling is not a gate.

## Optimizer findings

Advisory only — `status` is driven by `critical`-severity findings, so `info`/`low` findings never
fail a build. Severities: `info` · `low` · … · `critical`. Categories seen in practice: `ssg`,
plus scheduler hints (`long-serial-chain`, `unnecessary-barrier`, `duplicate-data-resolution`).

**Do not act on `recommendation` without checking it.** 10 of the current 19-slot findings are
wrong — see [F1](../known-limitations.md#f1).

## Runtime statuses

| Type | Values |
| --- | --- |
| `PageHealth` | `ok` · `degraded` · `unhealthy` |
| `FragmentSlotStatus` | `ok` · `fallback` · `skipped-dependency` |
| slot `source` | `static` · `cache` · `network` · `fallback` |
| `DataResolutionResult.status` | `ok` · `error` · `skipped-dependency` |
| island mismatch `reason` | `version-mismatch` · `contract-hash-mismatch` · `invalid-snapshot` · `invalid-props` |
| `SchedulerHintKind` | `long-serial-chain` · `unnecessary-barrier` · `duplicate-data-resolution` |
| `LivePhase` | `mount` · `frame` · `stop` |

## Typed errors

| Error | Thrown by |
| --- | --- |
| `RequestContractError`, `RequestPolicyError`, `RequestTimeoutError` | `@mvp/request` |
| `DataDependencyError` | `@mvp/data` |
| `InteractionContractError`, `MutationContractError` | `@mvp/interaction` |
| `StoragePolicyError` | `@mvp/storage` |
| `FileConflictError`, `FileLockTimeoutError` | `@mvp/registry` atomic writes |
| `InvalidManifestSlotsError` | `@mvp/registry` slot codegen |
| `WorkerManifestError`, `WorkerTaskCancelledError` | `@mvp/workers` |
| `OrderConstraintError` | `@mvp/trade-contracts` (domain example) |
