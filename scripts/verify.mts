import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const commands = [
  { cmd: "pnpm", args: ["typecheck"], timeoutMs: 60_000 },
  { cmd: "pnpm", args: ["lint"], timeoutMs: 60_000 },
  { cmd: "pnpm", args: ["check"], timeoutMs: 60_000 },
  // Refactor plan §3.4/§3.2: fails the same way a lint error would when a
  // page's `fragmentSlots.gen.ts` has drifted from `manifest.slots.json`.
  { cmd: "pnpm", args: ["verify:manifest-gen"], timeoutMs: 60_000 },
  // Refactor plan §6: docs/DEMOS.md's generated `demonstrates` block must
  // match every page manifest's `demonstrates` array — a hand-maintained
  // capability index already went stale once, so drift fails CI like a
  // lint error would (`scripts/verify-demos.mts --check`).
  { cmd: "pnpm", args: ["verify:demos"], timeoutMs: 60_000 },
  // Refactor plan §7: every AGENT.md fenced TypeScript snippet is executed
  // for real (not just typechecked), so a doc example that drifted from the
  // real exports fails the gate the same way a broken test would.
  { cmd: "pnpm", args: ["docs:test"], timeoutMs: 60_000 },
  // 180s: the full vitest sweep brushes 60s on loaded/CI machines
  // (documented contention flake) — headroom, not a behavior change.
  { cmd: "pnpm", args: ["test"], timeoutMs: 180_000 },
  // 300s: 8 Next.js apps + all packages; 120s was a repeated flake source
  // under parallel-agent contention and is tight for a 2-core CI runner.
  { cmd: "pnpm", args: ["build"], timeoutMs: 300_000 },
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
