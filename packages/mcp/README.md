# @mvp/mcp — DevX MCP server

Agent-callable surface for the framework's discovery + lifecycle. Implements
`docs/AI_NATIVE_DEVX.md` §3 + §7 and
`docs/ARCHITECTURE_REFACTOR_PLAN.md` §7 item 3 ("the lifecycle MCP server ...
published as `@mvp/mcp` so downstream agents connect instead of reading docs
at all"). Dependency-free (a minimal MCP stdio server, no
`@modelcontextprotocol/sdk`).

## Run

Inside this repo:

```bash
pnpm mcp             # stdio MCP server (== pnpm --filter @mvp/mcp start)
pnpm graph           # the same unit graph as a human CLI
pnpm graph --dependents-of order-book
pnpm graph --consumes book.l2
pnpm graph --kind component --json
```

Once published, from any consumer that has it installed:

```bash
npx @mvp/mcp          # runs the built dist/server.js via the package's `bin`
```

MCP config (stdio), in-repo dev form:

```json
{ "command": "pnpm", "args": ["mcp"], "cwd": "<repo root>" }
```

MCP config (stdio), published form:

```json
{ "command": "npx", "args": ["@mvp/mcp"], "cwd": "<repo root>" }
```

The server assumes it runs against a checkout of this monorepo (it shells out
to the repo's own `scripts/*.mts` lifecycle CLIs and reads `registry/*.json`
relative to a detected repo root) — publishing it makes it easy to *install*
into an agent's MCP config, not a repo-independent tool.

## Tools

| tool | what it does |
|---|---|
| `query_registry` | in-process query of the unit graph (routes/pages/components/data-sources); filters: `kind`, `name`, `dependentsOf`, `dependenciesOf`, `consumes` |
| `affected_units` | closure of units affected by a set of changed unit ids (walks reverse graph edges) |
| `scaffold_component` | `@mvp/create-component` |
| `register_fragment` | `scripts/register-fragment.mts` |
| `mount_slot` | `scripts/mount-slot.mts` (mount, `remove`, or `check` — verifies `fragmentSlots.gen.ts` is fresh without writing) |
| `promote_fragment` | canary → stable |
| `rollback_fragment` | stable → recorded/pinned version |
| `affected` | deployable units affected by a git diff |

The lifecycle tools wrap the existing scripts, which already emit structured
JSON, so multiple agents can drive the loop concurrently.

## Layout

- `src/tools.ts` — tool registry: `query_registry` handler + declarative
  lifecycle tools (input→CLI-arg mapping is pure, unit-tested in `tools.test.ts`).
- `src/server.ts` — minimal MCP JSON-RPC stdio transport; also the package's
  `bin` entry point once built.
- `src/index.ts` — library entry point (`devxTools`, `SCRIPT_TOOLS`, types)
  for programmatic use.
- The graph itself: `tools/release-tools/src/unit-graph.ts` (pure, tested) +
  `load-graph.ts` (reads the repo's manifests/registries) — consumed via
  relative import (that package has no build/export surface of its own) and
  inlined into the `dist/` bundle by `tsdown` at build time.

## Build & publish shape

`pnpm --filter @mvp/mcp build` runs `tsdown` over both entry points
(`src/index.ts` for the library surface, `src/server.ts` for the CLI/bin),
emitting `dist/index.js` (+`.d.ts`) and `dist/server.js` (shebang preserved).
No `npm publish` has been run against this package as part of shipping it —
only local build/typecheck/test verification.
