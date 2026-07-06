import { join } from "node:path";
import { ensureDir, writeJson, writeText } from "./fs";

export type CheckStatus = "pass" | "warn" | "fail";

export function statusFromCounts(failures: number, warnings = 0): CheckStatus {
  if (failures > 0) {
    return "fail";
  }
  if (warnings > 0) {
    return "warn";
  }
  return "pass";
}

export function writeReports(
  root: string,
  baseName: string,
  json: unknown,
  markdown: string,
): void {
  const reportsDir = join(root, "reports");
  ensureDir(reportsDir);
  writeJson(join(reportsDir, `${baseName}.json`), json);
  writeText(
    join(reportsDir, `${baseName}.md`),
    markdown.endsWith("\n") ? markdown : `${markdown}\n`,
  );
}

export function exitCodeFor(
  status: CheckStatus,
  ci: boolean,
  warnOnly: boolean,
): number {
  return ci && status === "fail" && !warnOnly ? 1 : 0;
}
