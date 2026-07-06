import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const commands = [
  { cmd: "pnpm", args: ["typecheck"], timeoutMs: 60_000 },
  { cmd: "pnpm", args: ["lint"], timeoutMs: 60_000 },
  { cmd: "pnpm", args: ["check"], timeoutMs: 60_000 },
  { cmd: "pnpm", args: ["test"], timeoutMs: 60_000 },
  { cmd: "pnpm", args: ["build"], timeoutMs: 120_000 },
  { cmd: "pnpm", args: ["audit:similarity"], timeoutMs: 60_000 },
  { cmd: "pnpm", args: ["audit:bundle"], timeoutMs: 60_000 },
  { cmd: "pnpm", args: ["audit:css"], timeoutMs: 60_000 },
  { cmd: "pnpm", args: ["audit:deps"], timeoutMs: 60_000 },
  { cmd: "pnpm", args: ["audit:optimizer"], timeoutMs: 60_000 },
  { cmd: "pnpm", args: ["audit:boundary"], timeoutMs: 60_000 },
] as const;

mkdirSync("reports", { recursive: true });

const results = commands.map(({ cmd, args, timeoutMs }) => {
  const startedAt = Date.now();
  const result = spawnSync(cmd, args, {
    stdio: "pipe",
    encoding: "utf8",
    timeout: timeoutMs,
    env: {
      ...process.env,
      NPM_CONFIG_PROXY: "",
      NPM_CONFIG_HTTPS_PROXY: "",
      npm_config_proxy: "",
      npm_config_https_proxy: "",
    },
  });
  const entry = {
    command: [cmd, ...args].join(" "),
    status: result.status === 0 ? "passed" : "failed",
    signal: result.signal,
    durationMs: Date.now() - startedAt,
    stdout: result.stdout.slice(-6000),
    stderr: result.stderr.slice(-6000),
  };
  console.log(
    `${entry.status === "passed" ? "PASS" : "FAIL"} ${entry.command}`,
  );
  return entry;
});

writeFileSync(
  "reports/verify-report.json",
  `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
);

if (results.some((item) => item.status === "failed")) process.exit(1);
