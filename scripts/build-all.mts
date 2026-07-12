/**
 * build-all — `pnpm -r build` wrapper with the uniform result envelope
 * (audit contract M6). Build output streams through inherited stdio; the
 * final stdout line is one JSON envelope, and the child's exit code passes
 * through unchanged.
 */

import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["-r", "build"], { stdio: "inherit" });
const exitCode = result.status ?? 1;
console.log(
  JSON.stringify(
    {
      tool: "build-all",
      status: exitCode === 0 ? "ok" : "failed",
      exitCode,
      ...(exitCode === 0 ? {} : { error: `pnpm -r build exited ${exitCode}` }),
    },
    null,
    2,
  ),
);
process.exit(exitCode);
