import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CI gate for refactor plan §3.4: "drift becomes impossible, then illegal".
 * Discovers every `apps/<page>` that has a `src/manifest.slots.json` (the
 * same discovery rule as `tools/release-tools/src/load-graph.ts`) — NOT by
 * the presence of `fragmentSlots.gen.ts`, which would let a deleted gen file
 * (or a page whose slots were never generated) silently drop out of the gate.
 *
 * - Non-empty slots array -> `mount-slot --page <page> --check` must report
 *   "fresh"; a missing gen file is stale (exit 1) like any other drift.
 * - Empty slots array (page-vaults, page-referrals: slotless by design) ->
 *   exempt-and-reported. These pages have no `fragmentSlots.gen.ts` on disk
 *   and no runtime slots wrapper; `mount-slot`'s codegen only materializes
 *   the gen file as a byproduct of a successful mount/unmount, so requiring
 *   an empty gen file here would force a hand-created file (exactly what
 *   this gate exists to forbid). If a gen file DOES exist alongside an empty
 *   manifest (e.g. the page's last slot was unmounted), it is checked, not
 *   exempted.
 */

type PageCheckResult = {
  page: string;
  status: "fresh" | "exempt" | "stale" | "failed" | "conflict";
  error?: string;
  reason?: string;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appsDir = join(root, "apps");

type DiscoveredPage = { page: string; slotCount: number; hasGenFile: boolean };

function discoverManifestPages(): DiscoveredPage[] {
  if (!existsSync(appsDir)) return [];
  const pages: DiscoveredPage[] = [];
  for (const name of readdirSync(appsDir)) {
    const slotsPath = join(appsDir, name, "src", "manifest.slots.json");
    if (!existsSync(slotsPath)) continue;
    const slots = JSON.parse(readFileSync(slotsPath, "utf8")) as unknown;
    pages.push({
      page: name,
      // -1 marks a malformed (non-array) manifest so it fails instead of
      // being mistaken for a slotless page.
      slotCount: Array.isArray(slots) ? slots.length : -1,
      hasGenFile: existsSync(
        join(appsDir, name, "src", "fragmentSlots.gen.ts"),
      ),
    });
  }
  return pages;
}

function checkPage(entry: DiscoveredPage): PageCheckResult {
  const { page } = entry;
  if (entry.slotCount < 0) {
    return {
      page,
      status: "failed",
      error: `apps/${page}/src/manifest.slots.json is not a JSON array`,
    };
  }
  if (entry.slotCount === 0 && !entry.hasGenFile) {
    return {
      page,
      status: "exempt",
      reason:
        "manifest.slots.json is an empty array (slotless page); no fragmentSlots.gen.ts expected",
    };
  }
  if (!entry.hasGenFile) {
    return {
      page,
      status: "stale",
      error:
        `apps/${page}/src/fragmentSlots.gen.ts is missing but manifest.slots.json declares ${entry.slotCount} slot(s); ` +
        "regenerate by rerunning the mount-slot mount/remove command for one of its slots (any successful write regenerates the gen file), " +
        `then verify with: pnpm exec tsx scripts/mount-slot.mts --page ${page} --check`,
    };
  }
  const result = spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/mount-slot.mts", "--page", page, "--check"],
    { cwd: root, encoding: "utf8" },
  );
  try {
    const parsed = JSON.parse(result.stdout) as {
      status?: string;
      error?: string;
    };
    return {
      page,
      status: (parsed.status as PageCheckResult["status"]) ?? "failed",
      ...(parsed.error ? { error: parsed.error } : {}),
    };
  } catch {
    return {
      page,
      status: "failed",
      error: (
        result.stderr ||
        result.stdout ||
        "mount-slot --check produced no parseable output"
      ).trim(),
    };
  }
}

const pages = discoverManifestPages();
const results = pages.map(checkPage);
const report = {
  tool: "verify-manifest-gen",
  generatedAt: new Date().toISOString(),
  pages: results,
  status: results.every(
    (entry) => entry.status === "fresh" || entry.status === "exempt",
  )
    ? "pass"
    : "fail",
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === "pass" ? 0 : 1;
