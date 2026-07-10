import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CI gate for refactor plan §3.4: "drift becomes impossible, then illegal".
 * Runs `mount-slot --page <page> --check` for every page that already has a
 * generated `fragmentSlots.gen.ts` (today: page-home only — the other pages
 * remain hand-wired pending rollout), so a stale generated file fails
 * `pnpm verify` the same way a lint error would.
 */

type PageCheckResult = {
  page: string;
  status: "fresh" | "stale" | "failed" | "conflict";
  error?: string;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appsDir = join(root, "apps");

function discoverGenPages(): string[] {
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir).filter((name) =>
    existsSync(join(appsDir, name, "src", "fragmentSlots.gen.ts")),
  );
}

function checkPage(page: string): PageCheckResult {
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

const pages = discoverGenPages();
const results = pages.map(checkPage);
const report = {
  tool: "verify-manifest-gen",
  generatedAt: new Date().toISOString(),
  pages: results,
  status: results.every((entry) => entry.status === "fresh") ? "pass" : "fail",
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === "pass" ? 0 : 1;
