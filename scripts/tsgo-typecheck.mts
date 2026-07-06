import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps", "fragments", "packages", "tools"];
const projects: string[] = [];

for (const root of roots) {
  if (!existsSync(root)) continue;
  for (const name of readdirSync(root)) {
    const config = join(root, name, "tsconfig.json");
    if (existsSync(config)) projects.push(config);
  }
}

mkdirSync("reports", { recursive: true });

const results = projects.map((config) => {
  const startedAt = Date.now();
  const result = spawnSync("pnpm", ["exec", "tsgo", "-p", config, "--noEmit"], {
    stdio: "pipe",
    encoding: "utf8",
  });
  return {
    config,
    status: result.status === 0 ? "passed" : "failed",
    durationMs: Date.now() - startedAt,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
});

const report = {
  tool: "tsgo",
  generatedAt: new Date().toISOString(),
  projectCount: projects.length,
  passed: results.filter((item) => item.status === "passed").length,
  failed: results.filter((item) => item.status === "failed").length,
  results,
};

writeFileSync(
  "reports/typecheck-report.json",
  `${JSON.stringify(report, null, 2)}\n`,
);

for (const item of results) {
  const marker = item.status === "passed" ? "PASS" : "FAIL";
  console.log(`${marker} ${item.config}`);
  if (item.status === "failed") {
    console.log(item.stdout);
    console.error(item.stderr);
  }
}

if (report.failed > 0) process.exit(1);
