import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["-r", "build"], { stdio: "inherit" });
process.exit(result.status ?? 1);
