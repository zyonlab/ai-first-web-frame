/**
 * DevX MCP tool registry (docs/AI_NATIVE_DEVX.md §7, Phase 1).
 *
 * Exposes the framework's discovery + lifecycle surface as agent-callable tools.
 * `query_registry` runs in-process off the unit graph; the lifecycle tools are
 * thin wrappers over the existing scripts, which already emit structured JSON —
 * so multiple agents can drive scaffold → register → mount → deploy → promote →
 * rollback concurrently without reading CLAUDE.md.
 *
 * The transport lives in `server.mts`; this module is pure enough to unit-test
 * (tool definitions + argument mapping + the in-process query handler).
 */

import { spawnSync } from "node:child_process";
import { loadUnitGraph } from "../../release-tools/src/load-graph.ts";
import {
  affectedClosure,
  queryRegistry,
  type RegistryQuery,
  type UnitKind,
} from "../../release-tools/src/unit-graph.ts";

export type ToolResult = { text: string; isError?: boolean };

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (
    input: Record<string, unknown>,
    ctx: { root: string },
  ) => Promise<ToolResult>;
};

/** A lifecycle tool: a script + a pure input→CLI-args mapping (unit-tested). */
type ScriptTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** pnpm sub-command tokens, e.g. ["exec","tsx","scripts/register-fragment.mts"]. */
  command: string[];
  /** Pure mapping from tool input to CLI args. */
  args: (input: Record<string, unknown>) => string[];
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

/** Appends `--flag value` when `value` is present. */
function flag(name: string, value: unknown): string[] {
  const s =
    str(value) ?? (typeof value === "number" ? String(value) : undefined);
  return s === undefined ? [] : [name, s];
}

/**
 * The lifecycle tools, declared as data so the arg mapping is unit-testable
 * separately from the (side-effectful) spawn.
 */
export const SCRIPT_TOOLS: ScriptTool[] = [
  {
    name: "scaffold_component",
    description:
      "Scaffold a new fragment (9 files) via @mvp/create-component. Input: { name: PascalCase, type?: 'fragment' }.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "PascalCase component name" },
        type: { type: "string", enum: ["fragment"], default: "fragment" },
      },
    },
    command: ["--filter", "@mvp/create-component", "start", "--"],
    args: (i) => [str(i.name) ?? "", "--type", str(i.type) ?? "fragment"],
  },
  {
    name: "register_fragment",
    description:
      "Register/update a fragment in the fragment registry. Input: { name, version, serviceUrl, channel?, withCompose? }.",
    inputSchema: {
      type: "object",
      required: ["name", "version", "serviceUrl"],
      properties: {
        name: { type: "string" },
        version: { type: "string" },
        serviceUrl: { type: "string" },
        channel: { type: "string", enum: ["canary", "stable"] },
        withCompose: { type: "boolean" },
      },
    },
    command: ["exec", "tsx", "scripts/register-fragment.mts"],
    args: (i) => [
      ...flag("--name", i.name),
      ...flag("--version", i.version),
      ...flag("--service-url", i.serviceUrl),
      ...flag("--channel", i.channel),
      ...(i.withCompose ? ["--with-compose"] : []),
    ],
  },
  {
    name: "mount_slot",
    description:
      "Mount (or --remove) a fragment into a page slot. Input: { page, slot, fragment?, strategy?, channel?, timeoutMs?, remove? }.",
    inputSchema: {
      type: "object",
      required: ["page", "slot"],
      properties: {
        page: { type: "string" },
        slot: { type: "string" },
        fragment: { type: "string" },
        strategy: { type: "string" },
        channel: { type: "string" },
        timeoutMs: { type: "number" },
        remove: { type: "boolean" },
      },
    },
    command: ["exec", "tsx", "scripts/mount-slot.mts"],
    args: (i) => [
      ...flag("--page", i.page),
      ...flag("--slot", i.slot),
      ...(i.remove ? ["--remove"] : flag("--fragment", i.fragment)),
      ...flag("--strategy", i.strategy),
      ...flag("--channel", i.channel),
      ...flag("--timeout-ms", i.timeoutMs),
    ],
  },
  {
    name: "promote_fragment",
    description: "Promote a fragment canary → stable. Input: { name }.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    },
    command: ["exec", "tsx", "scripts/promote-fragment.mts"],
    args: (i) => flag("--name", i.name),
  },
  {
    name: "rollback_fragment",
    description:
      "Roll a fragment's stable back to its recorded (or pinned) version. Input: { name, to? }.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" }, to: { type: "string" } },
    },
    command: ["exec", "tsx", "scripts/rollback-fragment.mts"],
    args: (i) => [...flag("--name", i.name), ...flag("--to", i.to)],
  },
  {
    name: "affected",
    description:
      "List deployable units affected by a git diff. Input: { base?, head? }.",
    inputSchema: {
      type: "object",
      properties: { base: { type: "string" }, head: { type: "string" } },
    },
    command: ["exec", "tsx", "scripts/affected.mts", "--list"],
    args: (i) => [...flag("--base", i.base), ...flag("--head", i.head)],
  },
];

/** Runs a pnpm-driven script and returns its stdout/stderr + exit code. */
function runPnpm(root: string, tokens: string[]): ToolResult {
  const proc = spawnSync("pnpm", tokens, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const out = (proc.stdout ?? "").trim();
  const err = (proc.stderr ?? "").trim();
  const ok = proc.status === 0;
  return {
    text: out || err || `exit ${proc.status}`,
    isError: !ok,
  };
}

/** The in-process discovery tool. */
const queryRegistryTool: ToolDef = {
  name: "query_registry",
  description:
    "Query the unit dependency graph (routes/pages/components/data-sources/slices). Input: { kind?, name?, dependentsOf?, dependenciesOf?, consumes? (data source), consumesSlice?, producesSlice? }. Returns units + touching edges.",
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["route", "page", "component", "data-source", "slice"],
      },
      name: { type: "string" },
      dependentsOf: { type: "string" },
      dependenciesOf: { type: "string" },
      consumes: { type: "string" },
      consumesSlice: { type: "string" },
      producesSlice: { type: "string" },
    },
  },
  handler: async (input, ctx) => {
    const graph = await loadUnitGraph(ctx.root);
    const query: RegistryQuery = {
      kind: str(input.kind) as UnitKind | undefined,
      name: str(input.name),
      dependentsOf: str(input.dependentsOf),
      dependenciesOf: str(input.dependenciesOf),
      consumesDataSource: str(input.consumes),
      consumesSlice: str(input.consumesSlice),
      producesSlice: str(input.producesSlice),
    };
    const result = queryRegistry(graph, query);
    return {
      text: JSON.stringify({ status: "ok", query, ...result }, null, 2),
    };
  },
};

/** Graph-aware blast radius: units to re-verify/redeploy for a set of changes. */
const affectedUnitsTool: ToolDef = {
  name: "affected_units",
  description:
    "Given directly-changed unit ids, return the full closure that must be re-verified/redeployed by walking reverse graph edges (component→pages, slice/source→consumers). Input: { changed: string[] }.",
  inputSchema: {
    type: "object",
    required: ["changed"],
    properties: {
      changed: { type: "array", items: { type: "string" } },
    },
  },
  handler: async (input, ctx) => {
    const graph = await loadUnitGraph(ctx.root);
    const changed = Array.isArray(input.changed)
      ? (input.changed as unknown[]).filter(
          (v): v is string => typeof v === "string",
        )
      : [];
    const units = affectedClosure(graph, changed);
    return {
      text: JSON.stringify(
        { status: "ok", changed, affected: units.map((u) => u.id), units },
        null,
        2,
      ),
    };
  },
};

/** All DevX MCP tools (discovery + lifecycle). */
export function devxTools(): ToolDef[] {
  const lifecycle: ToolDef[] = SCRIPT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    handler: async (input, ctx) =>
      runPnpm(ctx.root, [...tool.command, ...tool.args(input)]),
  }));
  return [queryRegistryTool, affectedUnitsTool, ...lifecycle];
}
