# mcp-devx — DevX MCP server (Phase 1)

Agent-callable surface for the framework's discovery + lifecycle. Implements
`docs/AI_NATIVE_DEVX.md` §3 + §7. Dependency-free (a minimal MCP stdio server,
no `@modelcontextprotocol/sdk`).

## Run

```bash
pnpm mcp:devx        # stdio MCP server (wire into an agent's MCP config)
pnpm graph           # the same unit graph as a human CLI
pnpm graph --dependents-of order-book
pnpm graph --consumes book.l2
pnpm graph --kind component --json
```

MCP config (stdio):

```json
{ "command": "pnpm", "args": ["mcp:devx"], "cwd": "<repo root>" }
```

## Tools

| tool | what it does |
|---|---|
| `query_registry` | in-process query of the unit graph (routes/pages/components/data-sources); filters: `kind`, `name`, `dependentsOf`, `dependenciesOf`, `consumes` |
| `scaffold_component` | `@mvp/create-component` |
| `register_fragment` | `scripts/register-fragment.mts` |
| `mount_slot` | `scripts/mount-slot.mts` (mount or `remove`) |
| `promote_fragment` | canary → stable |
| `rollback_fragment` | stable → recorded/pinned version |
| `affected` | deployable units affected by a git diff |

The lifecycle tools wrap the existing scripts, which already emit structured
JSON, so multiple agents can drive the loop concurrently.

## Layout

- `src/tools.ts` — tool registry: `query_registry` handler + declarative
  lifecycle tools (input→CLI-arg mapping is pure, unit-tested in `tools.test.ts`).
- `src/server.mts` — minimal MCP JSON-RPC stdio transport.
- The graph itself: `tools/release-tools/src/unit-graph.ts` (pure, tested) +
  `load-graph.ts` (reads the repo's manifests/registries).

## Next (design doc)

Phase 2 extends the manifest with `consumes`/`produces`/`layoutHint` and wires
`affected` into verify/deploy; Phase 3 adds `dev:component`; Phase 4 the
`verify:runtime` gate. See `docs/AI_NATIVE_DEVX.md`.
