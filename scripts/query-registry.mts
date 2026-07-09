/**
 * query-registry — the framework's unit dependency graph as a CLI (and the data
 * behind the MCP `query_registry` tool). See docs/AI_NATIVE_DEVX.md §3.
 *
 * Reads the artifacts that already exist — each fragment's `manifest.ts`, each
 * app's `manifest.slots.json`, the route registry, and the fragment registry —
 * assembles them with `tools/release-tools/unit-graph`, and answers discovery
 * queries an agent needs before touching anything.
 *
 * Usage:
 *   pnpm exec tsx scripts/query-registry.mts [--kind <k>] [--name <n>]
 *     [--dependents-of <id>] [--dependencies-of <id>] [--consumes <sourceId>]
 *     [--json]
 *
 * Examples:
 *   pnpm exec tsx scripts/query-registry.mts --json
 *   pnpm exec tsx scripts/query-registry.mts --dependents-of order-book
 *   pnpm exec tsx scripts/query-registry.mts --consumes book.l2
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnitGraph } from "../tools/release-tools/src/load-graph.ts";
import {
  queryRegistry,
  type RegistryQuery,
  type UnitKind,
} from "../tools/release-tools/src/unit-graph.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv: string[]): RegistryQuery & { json: boolean } {
  const q: RegistryQuery & { json: boolean } = { json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--json") {
      q.json = true;
      continue;
    }
    if (arg === "--kind") q.kind = value as UnitKind;
    else if (arg === "--name") q.name = value;
    else if (arg === "--dependents-of") q.dependentsOf = value;
    else if (arg === "--dependencies-of") q.dependenciesOf = value;
    else if (arg === "--consumes") q.consumesDataSource = value;
    else if (arg === "--consumes-slice") q.consumesSlice = value;
    else if (arg === "--produces-slice") q.producesSlice = value;
    else continue;
    i += 1;
  }
  return q;
}

async function main() {
  const { json, ...query } = parseArgs(process.argv.slice(2));
  const graph = await loadUnitGraph(ROOT);
  const result = queryRegistry(graph, query);

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ status: "ok", query, ...result }, null, 2)}\n`,
    );
    return;
  }
  const counts = graph.units.reduce<Record<string, number>>((acc, u) => {
    acc[u.kind] = (acc[u.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `unit graph: ${graph.units.length} units (${Object.entries(counts)
      .map(([k, n]) => `${n} ${k}`)
      .join(", ")}), ${graph.edges.length} edges`,
  );
  for (const unit of result.units) {
    const tags = [
      unit.kind,
      unit.owner,
      unit.channel,
      unit.version,
      unit.renderStrategy,
    ]
      .filter(Boolean)
      .join(" · ");
    console.log(`  ${unit.id.padEnd(28)} ${tags}`);
  }
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify({ status: "failed", error: String(error) })}\n`,
  );
  process.exitCode = 1;
});
