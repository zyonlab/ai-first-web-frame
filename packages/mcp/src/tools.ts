/**
 * DevX MCP tool registry (docs/AI_NATIVE_DEVX.md §7,
 * docs/ARCHITECTURE_REFACTOR_PLAN.md §7 item 3 — published as `@mvp/mcp`).
 *
 * Exposes the framework's discovery + lifecycle surface as agent-callable tools.
 * `query_registry` runs in-process off the unit graph; the lifecycle tools are
 * thin wrappers over the existing scripts, which already emit structured JSON —
 * so multiple agents can drive scaffold → register → mount → deploy → promote →
 * rollback concurrently without reading CLAUDE.md.
 *
 * The transport lives in `server.ts`; this module is pure enough to unit-test
 * (tool definitions + argument mapping + the in-process query handler).
 *
 * `tools/release-tools` has no package export surface of its own (it is a
 * private, unbuilt dev-tooling package consumed via deep relative imports
 * elsewhere in the repo, e.g. `scripts/mount-slot.mts`) — so the pure graph
 * helpers below are imported the same way and get inlined by `tsdown` at
 * build time rather than declared as an npm dependency.
 */

import { spawnSync } from "node:child_process";
import { loadUnitGraph } from "../../../tools/release-tools/src/load-graph";
import {
  affectedClosure,
  queryRegistry,
  type RegistryQuery,
  type UnitKind,
} from "../../../tools/release-tools/src/unit-graph";
import { findSchemaViolation } from "./validate";

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
      "Mount (or --remove) a fragment into a page slot, or --check that the page's " +
      "generated fragmentSlots.gen.ts is still fresh against manifest.slots.json " +
      "without writing anything (refactor plan §3.2). Input: { page, slot, " +
      "fragment?, strategy?, channel?, timeoutMs?, remove?, check? }. `slot` and " +
      "`fragment` are only required when neither `remove` nor `check` is set.",
    inputSchema: {
      type: "object",
      required: ["page"],
      properties: {
        page: { type: "string" },
        slot: { type: "string" },
        fragment: { type: "string" },
        strategy: { type: "string" },
        channel: { type: "string" },
        timeoutMs: { type: "number" },
        remove: { type: "boolean" },
        check: {
          type: "boolean",
          description:
            "Verify fragmentSlots.gen.ts is in sync with manifest.slots.json; writes nothing.",
        },
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
      // --check (refactor plan §3.2) is a pure verification mode: it accepts
      // the same flags a mount/remove call would use but ignores them, only
      // checking that fragmentSlots.gen.ts is fresh for --page. Appended last
      // so { page, check: true } alone is a valid, minimal check call.
      ...(i.check ? ["--check"] : []),
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
      "Compute the affected plan for a git diff via the graph engine " +
      "(scripts/affected-graph.mts): seed units, whether the diff is GLOBAL, " +
      "the full affected-unit closure, deployable images to rebuild, and " +
      "pages to runtime-verify. Input: { base?, head? }. To go the other " +
      "direction — starting from already-known unit ids instead of a git " +
      "diff — use `affected_units`.",
    inputSchema: {
      type: "object",
      properties: { base: { type: "string" }, head: { type: "string" } },
    },
    command: ["exec", "tsx", "scripts/affected-graph.mts", "--json"],
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
    "Given directly-changed unit ids, return the full closure that must be re-verified/redeployed by walking reverse graph edges (component→pages, slice/source→consumers). Input: { changed: string[] }. Starting from a git diff instead of known unit ids? Use `affected`, which also runs on the graph engine and derives the seed units for you.",
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

/**
 * Wraps a tool handler with input validation against its own declared
 * `inputSchema` (audit contract M5). Runs before anything side-effectful —
 * for lifecycle tools that means before the subprocess spawn — so a
 * wrong-typed argument (`page: 123`) is an explicit `isError: true` result
 * naming the violation path and expected type, never a silently dropped CLI
 * flag. The error text is the same `{status: "failed", error}` JSON envelope
 * the underlying scripts print, so callers parse one shape for both.
 */
function withInputValidation(tool: ToolDef): ToolDef {
  return {
    ...tool,
    handler: async (input, ctx) => {
      const violation = findSchemaViolation(tool.inputSchema, input ?? {});
      if (violation) {
        return {
          text: JSON.stringify({
            status: "failed",
            tool: tool.name,
            error: `invalid arguments: ${violation}`,
          }),
          isError: true,
        };
      }
      return tool.handler(input, ctx);
    },
  };
}

/** All DevX MCP tools (discovery + lifecycle), input-validated per schema. */
export function devxTools(): ToolDef[] {
  const lifecycle: ToolDef[] = SCRIPT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    handler: async (input, ctx) =>
      runPnpm(ctx.root, [...tool.command, ...tool.args(input)]),
  }));
  return [queryRegistryTool, affectedUnitsTool, ...lifecycle].map(
    withInputValidation,
  );
}
