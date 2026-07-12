import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  checkDemosBlockFreshness,
  type PageDemosEntry,
  renderDemosBlock,
  replaceDemosBlock,
} from "../tools/release-tools/src/demos-block";

/**
 * Freshness gate for `docs/DEMOS.md` (refactor plan §6): the generated
 * `demonstrates` block must stay byte-identical to what every
 * `apps/page-<name>/src/manifest.ts` `demonstrates` array produces right now.
 *
 *   --check  compare only, write nothing; exit 1 when stale.
 *            This is what `pnpm verify:demos` (a `pnpm verify` gate) runs.
 *   --write  regenerate the block in place (hand-written prose outside the
 *            markers is untouched).
 *
 * Same meta-lesson as `verify-manifest-gen`: a hand-maintained capability
 * index rotted within one merge cycle, so the table is generated from the
 * manifests and drift now fails CI instead of waiting to mislead an agent.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appsDir = join(root, "apps");
const demosPath = join(root, "docs", "DEMOS.md");

const usage = "usage: pnpm exec tsx scripts/verify-demos.mts --check | --write";

function fail(error: string): never {
  console.log(
    JSON.stringify({ tool: "verify-demos", status: "failed", error }, null, 2),
  );
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const check = args.delete("--check");
const write = args.delete("--write");
if (args.size > 0 || check === write) fail(usage);

async function loadPageEntries(): Promise<PageDemosEntry[]> {
  const pages = readdirSync(appsDir)
    .filter((name) => name.startsWith("page-"))
    .filter((name) => existsSync(join(appsDir, name, "src", "manifest.ts")));
  const entries: PageDemosEntry[] = [];
  for (const page of pages) {
    const manifestPath = join(appsDir, page, "src", "manifest.ts");
    const mod = (await import(pathToFileURL(manifestPath).href)) as Record<
      string,
      unknown
    >;
    // Same convention as tools/release-tools/src/load-graph.ts: the page
    // exports `<camelName>PageManifest`; pick the export that looks like a
    // page manifest (string `name` + string `route`).
    const manifest = Object.values(mod).find(
      (
        value,
      ): value is { name: string; route: string; demonstrates?: unknown } =>
        typeof value === "object" &&
        value !== null &&
        typeof (value as { name?: unknown }).name === "string" &&
        typeof (value as { route?: unknown }).route === "string",
    );
    if (!manifest) {
      fail(
        `${relative(root, manifestPath)} exports no page manifest object (expected an export with string "name" and "route")`,
      );
    }
    const demonstrates = manifest.demonstrates ?? [];
    if (
      !Array.isArray(demonstrates) ||
      demonstrates.some((value) => typeof value !== "string")
    ) {
      fail(
        `${relative(root, manifestPath)}: "demonstrates" must be a string array when present`,
      );
    }
    entries.push({ page, route: manifest.route, demonstrates });
  }
  return entries;
}

const entries = await loadPageEntries();
const expectedBlock = renderDemosBlock(entries);
if (!existsSync(demosPath)) fail(`${relative(root, demosPath)} does not exist`);
const document = readFileSync(demosPath, "utf8");

if (write) {
  let updated: string;
  try {
    updated = replaceDemosBlock(document, expectedBlock);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const changed = updated !== document;
  if (changed) writeFileSync(demosPath, updated);
  console.log(
    JSON.stringify(
      {
        tool: "verify-demos",
        generatedAt: new Date().toISOString(),
        status: "pass",
        action: changed ? "written" : "unchanged",
        pages: entries,
        files: changed ? [relative(root, demosPath)] : [],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const freshness = checkDemosBlockFreshness(expectedBlock, document);
const report = {
  tool: "verify-demos",
  generatedAt: new Date().toISOString(),
  status: freshness.status === "fresh" ? "pass" : "fail",
  demosFile: relative(root, demosPath),
  pages: entries,
  ...(freshness.status === "stale"
    ? {
        error: `${relative(root, demosPath)}'s generated demonstrates block is stale relative to the page manifests; regenerate with: pnpm exec tsx scripts/verify-demos.mts --write`,
      }
    : {}),
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === "pass" ? 0 : 1;
