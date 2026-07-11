# @mvp/mcp — AGENT.md

## What this package is for

`@mvp/mcp` is a minimal, dependency-free MCP (Model Context Protocol) stdio
server that exposes this framework's discovery + lifecycle surface as
agent-callable tools, so a downstream agent can connect to it instead of
reading `CLAUDE.md`/`docs/OPERATIONS.md` and shelling out to `pnpm exec tsx
scripts/*.mts` by hand. It implements just enough of the MCP JSON-RPC surface
(`initialize`, `tools/list`, `tools/call`) over newline-delimited stdio to
need no `@modelcontextprotocol/sdk` dependency. It exposes two kinds of
tools: an in-process `query_registry` (+ `affected_units`) that reads the
unit dependency graph directly, and a set of lifecycle tools that are thin
wrappers around the repo's existing `scripts/*.mts` CLIs (which already print
structured JSON, so multiple agents can drive scaffold -> register -> mount
-> promote -> rollback concurrently through this server exactly as they could
through the CLIs directly). The server assumes it runs against a checkout of
this monorepo — it shells out to the repo's own scripts and reads
`registry/*.json` relative to a detected repo root — so publishing it makes
it easy to *install* into an agent's MCP config, not a repo-independent tool.

## Entry points

### Library (`src/index.ts`, `src/tools.ts`)

- `devxTools(): ToolDef[]` — the full tool list (`query_registry`,
  `affected_units`, plus one `ToolDef` per `SCRIPT_TOOLS` entry). Each
  `ToolDef` is `{ name, description, inputSchema, handler(input, { root })
  => Promise<ToolResult> }`, `ToolResult = { text: string, isError?: boolean }`.
  Use this for programmatic/in-process access to the same tools the stdio
  server exposes (tests, or embedding the tool set into another server).
- `SCRIPT_TOOLS: ScriptTool[]` — the lifecycle tools declared as data:
  `{ name, description, inputSchema, command: string[], args: (input) => string[] }`.
  `args` is a **pure** input→CLI-args mapping, unit-tested independent of the
  (side-effectful) `spawnSync` call — read this array directly to see exactly
  which CLI flags a tool input maps to.

**The tool list** (`name` — input shape — wraps):

| tool | input | wraps |
|---|---|---|
| `query_registry` | `{ kind?, name?, dependentsOf?, dependenciesOf?, consumes?, consumesSlice?, producesSlice? }` | in-process `queryRegistry` over the unit graph (`tools/release-tools/src/unit-graph.ts`) |
| `affected_units` | `{ changed: string[] }` | in-process `affectedClosure` — reverse-graph-edge closure of the given unit ids |
| `scaffold_component` | `{ name: PascalCase, type?: "fragment" }` | `@mvp/create-component start` |
| `register_fragment` | `{ name, version, serviceUrl, channel?, withCompose? }` | `scripts/register-fragment.mts` |
| `mount_slot` | `{ page, slot?, fragment?, strategy?, channel?, timeoutMs?, remove?, check? }` | `scripts/mount-slot.mts` |
| `promote_fragment` | `{ name }` | `scripts/promote-fragment.mts` |
| `rollback_fragment` | `{ name, to? }` | `scripts/rollback-fragment.mts` |
| `affected` | `{ base?, head? }` | `scripts/affected-graph.mts --json` |

- **`mount_slot`'s `check` flag**: `slot`/`fragment` are only required when
  neither `remove` nor `check` is set — `{ page, check: true }` alone is a
  valid, minimal call. It maps to `mount-slot.mts --page <page> --check`,
  which verifies the page's generated `fragmentSlots.gen.ts` is still in sync
  with `manifest.slots.json` and **writes nothing**; any other flags passed
  alongside `check: true` are accepted but ignored by the underlying script.
  See `docs/OPERATIONS.md` step 4 for the full mount/check contract
  (`"fresh"` vs `"stale"` results).
- **`query_registry`**: runs `loadUnitGraph(root)` then `queryRegistry(graph,
  query)` — no subprocess, no filesystem writes. `kind` is one of `"route" |
  "page" | "component" | "data-source" | "slice"`.
- **`affected_units`**: runs `loadUnitGraph(root)` then `affectedClosure(graph,
  changed)` — also in-process; `changed` is a list of unit ids (not file
  paths — use `affected`/`scripts/affected-graph.mts` to go from a git diff to
  unit ids first).
- **`affected`**: a lifecycle (subprocess) tool, unlike `query_registry` and
  `affected_units` above — it shells to `scripts/affected-graph.mts --json
  [--base <ref>] [--head <ref>]`, the same graph engine `.github/workflows/ci.yml`
  and `scripts/deploy-affected.mts` use, so a given diff always produces one
  answer. Result JSON: `{ status, seeds, global, affectedUnits, deployables,
  affectedPages }` — `global: true` means a shared/unresolvable path forced a
  full rebuild. Prefer `affected` when you have a git diff (or want the repo's
  current working-tree diff, the default with no input) and `affected_units`
  when you already know the changed unit ids and just want the reverse-graph
  closure.

### Transport (`src/server.ts`)

- Reads newline-delimited JSON-RPC 2.0 messages from stdin, dispatches
  `initialize`, `notifications/initialized`, `ping`, `tools/list`,
  `tools/call`, and writes one JSON-RPC response line per request to stdout.
  Unparseable input lines are silently dropped rather than crashing the
  server. `PROTOCOL_VERSION = "2024-11-05"`.
- `tools/call` looks up the tool by `params.name`, calls its handler with
  `params.arguments` and `{ root: <detected repo root> }`, and wraps the
  result as `{ content: [{ type: "text", text: result.text }], isError:
  result.isError ?? false }`. A handler that throws is caught and reported as
  `isError: true` with the error's `String(error)` as the text, not a
  JSON-RPC protocol error — only an unknown tool name or unknown method use
  the JSON-RPC `error` field (see below).
- Run inside this repo: `pnpm mcp` (== `pnpm --filter @mvp/mcp start`). Once
  built + published: `npx @mvp/mcp` (the package's `bin`, `mvp-mcp`, built by
  `pnpm --filter @mvp/mcp build`).

## Error taxonomy

- **Unknown tool** (`tools/call` with a `name` not in `devxTools()`) — a
  JSON-RPC error response: `{ error: { code: -32602, message: 'unknown tool
  "<name>"' } }`. No tool handler runs.
- **Unknown method** (anything other than `initialize`,
  `notifications/initialized`, `ping`, `tools/list`, `tools/call`) — a
  JSON-RPC error response: `{ error: { code: -32601, message: "method not
  found: <method>" } }`. Notifications (no `id`) get no response at all,
  matching JSON-RPC semantics.
- **Tool handler failure** — never a JSON-RPC protocol error. A lifecycle
  tool's underlying script exiting non-zero (e.g. `register_fragment` on a
  duplicate port, `mount_slot` on an unregistered fragment without
  `--allow-unregistered` support in that tool's mapped flags) surfaces as a
  normal `tools/call` result with `isError: true` and `text` set to the
  script's stdout/stderr (or `exit <code>` if both are empty) — the caller
  must parse `text` as JSON (the script's own `{status, ...}` envelope, see
  `docs/OPERATIONS.md`) to distinguish failure reasons, the same way it would
  reading the CLI's stdout directly.
- **In-process tool throw** (`query_registry`/`affected_units` handler
  throws, e.g. a malformed manifest the graph loader can't parse) — caught by
  `server.ts`'s `tools/call` handler and reported as `isError: true` with
  `text: "tool error: <String(error)>"`.

## Example

The full connect -> list -> call flow over the newline-delimited JSON-RPC
transport (`src/server.ts`), calling `query_registry` for every `component`
unit:

```
--> {"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
<-- {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"@mvp/mcp","version":"0.1.0"}}}

--> {"jsonrpc":"2.0","method":"notifications/initialized"}
    (no response — it's a notification, no "id")

--> {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"query_registry","arguments":{"kind":"component"}}}
<-- {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\n  \"status\": \"ok\",\n  \"query\": { \"kind\": \"component\" },\n  \"units\": [ ... ],\n  \"edges\": [ ... ]\n}"}],"isError":false}}
```

MCP config (stdio), wiring this server into an agent, in-repo dev form:

```json
{ "command": "pnpm", "args": ["mcp"], "cwd": "<repo root>" }
```

Programmatic (no stdio transport, in-process):

```ts
import { devxTools } from "@mvp/mcp";

const tools = devxTools();
const queryRegistry = tools.find((t) => t.name === "query_registry")!;
const result = await queryRegistry.handler(
  { kind: "component" },
  { root: process.cwd() },
);
console.log(JSON.parse(result.text).units);
```

## Accept

```
pnpm --filter @mvp/mcp test
```
Expected: Vitest exits 0. `packages/mcp/src/tools.test.ts` covers the tool
registry shape (every tool has a description + object input schema) and the
pure lifecycle arg-mapping functions (`register_fragment`, `mount_slot`'s
mount/remove branching) without spawning any subprocess.
