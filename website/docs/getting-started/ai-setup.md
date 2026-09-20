# AI setup

This is the axis with no framework-level competitor, so it is worth being concrete about what
exists rather than gesturing at "AI-friendly".

## The four mechanisms

### 1. One operations manual at the repository root

`CLAUDE.md` is the agent's entry point: hard rules, directory map, the fragment lifecycle with
accept criteria per step, common commands, and a failure-recovery table keyed by the exact
string a script prints. `AGENTS.md` is a **symlink** to it, so the two cannot drift.

### 2. Per-package `AGENT.md`, executed by CI

Every `packages/*` and `domains/*` directory ships an `AGENT.md` with an *Entry points*
section, worked examples, and an *Accept* block. The fenced `ts`/`tsx` blocks are **run** by
`pnpm docs:test`, which is one of the 14 `pnpm verify` gates.

```sh
pnpm docs:test        # 36 AGENT.md files, 41 executable blocks, 7 marked no-run
```

A block that needs to be illustrative rather than runnable is marked ` ```ts no-run `, and the
report counts those separately (`noRunBlocks`) — so "we skipped it" is visible rather than
silent. An example that stops compiling or stops asserting is a red build.

This is the mechanism that makes the rest trustworthy: documentation an agent reads is
documentation CI proved still works.

### 3. Eight MCP tools

`pnpm mcp` starts the server (`packages/mcp/src/server.ts`). Tools:

| Tool | Wraps |
| --- | --- |
| `scaffold_component` | `@mvp/create-component` |
| `register_fragment` | `scripts/register-fragment.mts` |
| `mount_slot` | `scripts/mount-slot.mts` (including `--remove` / `--check`) |
| `promote_fragment` | `scripts/promote-fragment.mts` |
| `rollback_fragment` | `scripts/rollback-fragment.mts` |
| `affected` | the affected-plan graph engine |
| `query_registry` | the unit dependency graph |
| `affected_units` | closure of units to re-verify given changed unit ids |

`packages/mcp/src/validate.ts` adds `findSchemaViolation` for checking a payload against the
exported contracts.

The first six delegate to the same CLIs a human runs, so there is one implementation and one set
of semantics — a tool's behaviour cannot drift from the documented command, only its description
can, which is what [F12](../known-limitations.md#f12) was.

### 4. Structured CLI output and typed failures

Every lifecycle CLI prints JSON with a `status`, and the status vocabulary is closed:

| Script | Statuses |
| --- | --- |
| `register-fragment` | `registered` · `conflict` · `failed` |
| `mount-slot` | `mounted` · `conflict` · `failed` |
| `promote-fragment` | `promoted` · `unchanged` · `conflict` · `failed` |
| `rollback-fragment` | `rolled-back` · `unchanged` · `conflict` · `failed` |
| `verify-manifest-gen` | `fresh` · `stale` · `exempt` · `failed` |
| `verify-unit` | `ok` · `passed` · `skipped` · `failed` |

Unknown flags are rejected rather than ignored: each script passes its allowlist to
`unknownFlagError`, which returns a `did you mean --<flag>?` suggestion. A typo like
`--chanel canary` used to be silently dropped and the script proceeded on defaults; now it is
`{"status":"failed"}` with no write.

Machine-readable rule codes for every audit are in [reference/diagnostics](../reference/diagnostics.md).

## Recommended agent loop

1. Read `CLAUDE.md`, then the `AGENT.md` of the package you are touching.
2. Make the change.
3. `pnpm --filter <pkg> test` for the tight loop.
4. `pnpm verify` before claiming done; read `reports/*.json`, not just the exit code.
5. For a fragment, also `pnpm verify:unit --name <fragment>`.

## What still costs an agent time

Documented honestly, because these are the places an agent currently has to guess:

- Two flags exist only in code, not in the manual ([F4](../known-limitations.md#f4)).
- The advisory optimizer report contains confidently wrong advice for 10 of 19 slots
  ([F1](../known-limitations.md#f1)) — an agent that acts on `recommendation` will break the
  realtime panels.
- `reports/` at the repo root and `docs/reports/` are different things with similar names.
- Nothing compares a file count asserted in prose against what the scaffolder actually writes,
  so that class of drift recurs silently ([F12](../known-limitations.md#f12)).
