/**
 * Docker Compose smoke test CLI.
 *
 * Prerequisite: the Compose stack must already be running, e.g.
 *   docker compose -f infra/docker/docker-compose.yml build --provenance=false --sbom=false
 *   docker compose -f infra/docker/docker-compose.yml up -d --no-build
 *
 * Then run:
 *   pnpm exec tsx scripts/docker-smoke.mts [--timeout <seconds>] [--interval <ms>] [--host <host>]
 *
 * Polls /health on the shell gateway, every registered fragment service, and
 * every routed Next.js page app, plus the shell gateway's composed home and
 * product routes including their HTML markers. The check list is derived
 * from registry/registry.data.json and packages/routes/src/registry.ts, so
 * new fragments/pages get covered automatically. The derivation imports
 * @mvp/routes sources, whose @mvp/contracts import resolves to its dist/
 * under tsx — on a fresh checkout run `pnpm --filter @mvp/contracts build`
 * once first. Prints a JSON result to stdout and exits non-zero on timeout
 * or failure. Check derivation and polling logic live in
 * tools/release-tools/src/smoke.ts and are unit tested there.
 */

import {
  createDefaultSmokeChecks,
  type HttpFetcher,
  runSmokeSuite,
} from "../tools/release-tools/src/smoke.ts";

const HELP = `Usage: pnpm exec tsx scripts/docker-smoke.mts [options]

Options:
  --timeout <seconds>   Overall deadline for all checks (default: 120)
  --interval <ms>       Delay between poll rounds (default: 2000)
  --host <host>         Host serving the compose ports (default: localhost)
  --help                Show this help

Requires the Docker Compose stack from infra/docker/docker-compose.yml to be
up. Exits 0 when every check passes, 1 on failure or timeout, 2 on bad usage.
`;

type CliArgs = { timeoutMs: number; intervalMs: number; host: string };

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    timeoutMs: 120_000,
    intervalMs: 2_000,
    host: "localhost",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : argv[++index];
      if (next === undefined) {
        process.stderr.write(`Missing value for ${arg}\n\n${HELP}`);
        process.exit(2);
      }
      return next;
    };
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (arg === "--timeout" || arg.startsWith("--timeout=")) {
      const seconds = Number(value());
      if (!Number.isFinite(seconds) || seconds <= 0) {
        process.stderr.write(`Invalid --timeout value\n\n${HELP}`);
        process.exit(2);
      }
      args.timeoutMs = seconds * 1_000;
    } else if (arg === "--interval" || arg.startsWith("--interval=")) {
      const ms = Number(value());
      if (!Number.isFinite(ms) || ms <= 0) {
        process.stderr.write(`Invalid --interval value\n\n${HELP}`);
        process.exit(2);
      }
      args.intervalMs = ms;
    } else if (arg === "--host" || arg.startsWith("--host=")) {
      args.host = value();
    } else {
      process.stderr.write(`Unknown argument: ${arg}\n\n${HELP}`);
      process.exit(2);
    }
  }
  return args;
}

const fetcher: HttpFetcher = async (url) => {
  // Per-request timeout so a hung service cannot stall the whole suite;
  // redirects are followed (page-product redirects / to /product/123).
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });
  return {
    status: response.status,
    body: await response.text(),
    headers: Object.fromEntries(response.headers),
  };
};

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const checks = createDefaultSmokeChecks(args.host);
  const suite = await runSmokeSuite(checks, fetcher, {
    timeoutMs: args.timeoutMs,
    intervalMs: args.intervalMs,
  });

  // `status` is the uniform envelope field (audit contract M6); `ok` and the
  // other keys are kept verbatim for existing consumers of this output.
  process.stdout.write(
    `${JSON.stringify(
      {
        tool: "docker-smoke",
        status: suite.ok ? "ok" : "failed",
        ok: suite.ok,
        elapsedMs: suite.elapsedMs,
        timeoutMs: args.timeoutMs,
        checks: suite.checks,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(suite.ok ? 0 : 1);
}

main().catch((error) => {
  // Unexpected crash (not a failing check): same envelope shape, not raw text.
  process.stdout.write(
    `${JSON.stringify(
      {
        tool: "docker-smoke",
        status: "failed",
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    )}\n`,
  );
  process.exit(1);
});
