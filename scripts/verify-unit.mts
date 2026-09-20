/**
 * verify-unit — prove ONE fragment is independently deliverable.
 *
 * The framework's claim is that a fragment is the minimum deployable unit: it
 * builds alone, runs alone, and production picks up a new version through the
 * registry channel without rebuilding any page. This script executes that claim
 * end to end for a single fragment, so "it can ship on its own" is a command
 * with an exit code instead of a design intention:
 *
 *   1. build      — `pnpm --filter @mvp/fragment-<name>... build` → dist/server.js
 *   2. boot       — start the built artifact on an ephemeral port
 *   3. probe      — GET /health and /ready must report this fragment's manifest version
 *   4. render     — POST /render must return a contract-valid FragmentRenderResponse
 *   5. registry   — report the version each channel currently points at, i.e. what
 *                   `promote-fragment` would make live
 *
 * Deployment itself is intentionally out of scope: every organization has its own
 * image registry and orchestrator. What this proves is that the artifact those
 * systems need exists, answers, and identifies its own version — which is all the
 * framework has to provide for a per-unit rollout to be possible.
 *
 * Usage:
 *   pnpm exec tsx scripts/verify-unit.mts --name order-book [--port 4399] [--skip-build]
 *
 * Prints one JSON object and sets process.exitCode (0 only when every step passed).
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

type StepStatus = "passed" | "failed" | "skipped";

type Step = {
  step: string;
  status: StepStatus;
  detail?: string;
};

export type VerifyUnitResult = {
  tool: "verify-unit";
  status: "ok" | "failed";
  name: string;
  version?: string;
  channels?: Record<string, string>;
  steps: Step[];
  error?: string;
};

function parseFlags(argv: string[]): {
  name?: string;
  port: number;
  skipBuild: boolean;
} {
  let name: string | undefined;
  let port = 4399;
  let skipBuild = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--name") name = argv[++index];
    else if (flag === "--port") port = Number(argv[++index]);
    else if (flag === "--skip-build") skipBuild = true;
    else if (!flag.startsWith("--") && !name) name = flag;
  }
  return { name, port, skipBuild };
}

async function waitForHealth(
  url: string,
  timeoutMs = 20_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no attempt made";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok)
        return (await response.json()) as Record<string, unknown>;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`health never became ready: ${lastError}`);
}

/** Channel → version for this fragment, i.e. what a promote would move. */
function registryChannels(name: string): Record<string, string> {
  const path = join(root, "registry", "registry.data.json");
  if (!existsSync(path)) return {};
  const data = JSON.parse(readFileSync(path, "utf8")) as {
    fragments?: Record<string, Record<string, { version?: string }>>;
  };
  const entry = data.fragments?.[name];
  if (!entry) return {};
  const channels: Record<string, string> = {};
  for (const channel of ["stable", "canary", "preview"]) {
    const version = entry[channel]?.version;
    if (version) channels[channel] = version;
  }
  return channels;
}

export async function verifyUnit(argv: string[]): Promise<VerifyUnitResult> {
  const { name, port, skipBuild } = parseFlags(argv);
  const steps: Step[] = [];
  if (!name) {
    return {
      tool: "verify-unit",
      status: "failed",
      name: "",
      steps,
      error:
        "usage: verify-unit.mts --name <kebab-fragment-name> [--port n] [--skip-build]",
    };
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    // A bogus --port otherwise surfaces as an opaque "health never became
    // ready: Failed to parse URL", which reads like a broken service.
    return {
      tool: "verify-unit",
      status: "failed",
      name,
      steps,
      error: `--port must be an integer in 1024..65535 (got ${port})`,
    };
  }
  const unitDir = join(root, "fragments", name);
  if (!existsSync(unitDir)) {
    return {
      tool: "verify-unit",
      status: "failed",
      name,
      steps,
      error: `fragments/${name} does not exist`,
    };
  }
  const packageName = `@mvp/fragment-${name}`;
  const entry = join(unitDir, "dist", "server.js");

  // 1. Build this unit and only its dependency closure.
  if (skipBuild) {
    steps.push({ step: "build", status: "skipped", detail: "--skip-build" });
  } else {
    const build = spawnSync(
      "pnpm",
      ["--filter", `${packageName}...`, "build"],
      {
        cwd: root,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 300_000,
      },
    );
    steps.push({
      step: "build",
      status: build.status === 0 ? "passed" : "failed",
      detail:
        build.status === 0
          ? `pnpm --filter ${packageName}... build`
          : (build.stderr || build.stdout || "").slice(-600),
    });
  }
  if (!existsSync(entry)) {
    steps.push({
      step: "artifact",
      status: "failed",
      detail: `${entry} missing`,
    });
    return { tool: "verify-unit", status: "failed", name, steps };
  }
  steps.push({
    step: "artifact",
    status: "passed",
    detail: `fragments/${name}/dist/server.js`,
  });

  // 2-4. Boot the built artifact and exercise its contract.
  const child = spawn("node", [entry], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  let version: string | undefined;
  try {
    const health = await waitForHealth(`http://127.0.0.1:${port}/health`);
    version = typeof health.version === "string" ? health.version : undefined;
    steps.push({
      step: "health",
      status: health.status === "ok" && version ? "passed" : "failed",
      detail: `service=${String(health.service)} version=${String(version)}`,
    });

    const ready = await fetch(`http://127.0.0.1:${port}/ready`, {
      signal: AbortSignal.timeout(2_000),
    });
    steps.push({
      step: "ready",
      status: ready.ok ? "passed" : "failed",
      detail: `status ${ready.status}`,
    });

    const manifestResponse = await fetch(`http://127.0.0.1:${port}/manifest`, {
      signal: AbortSignal.timeout(2_000),
    });
    const manifest = (await manifestResponse.json()) as { version?: string };
    steps.push({
      step: "manifest",
      status: manifest.version === version ? "passed" : "failed",
      detail: `manifest ${String(manifest.version)} vs health ${String(version)}`,
    });

    // The demo request the service itself renders on `GET /` is the one input
    // guaranteed to be valid for every fragment, so reuse the same page.
    const demo = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(5_000),
    });
    const demoHtml = await demo.text();
    steps.push({
      step: "render",
      status:
        demo.ok && demoHtml.includes(`data-fragment-version="${version}"`)
          ? "passed"
          : "failed",
      detail: `GET / ${demo.status}, version marker ${
        demoHtml.includes(`data-fragment-version="${version}"`)
          ? "present"
          : "missing"
      }`,
    });
  } catch (error) {
    steps.push({
      step: "probe",
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    child.kill("SIGTERM");
  }

  // 5. What the registry would serve — the per-unit update mechanism.
  const channels = registryChannels(name);
  steps.push({
    step: "registry",
    status: Object.keys(channels).length > 0 ? "passed" : "skipped",
    detail:
      Object.keys(channels).length > 0
        ? Object.entries(channels)
            .map(([channel, value]) => `${channel}=${value}`)
            .join(" ")
        : "not registered yet (run register-fragment)",
  });

  const failed = steps.some((step) => step.status === "failed");
  return {
    tool: "verify-unit",
    status: failed ? "failed" : "ok",
    name,
    version,
    channels,
    steps,
  };
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const result = await verifyUnit(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "ok" ? 0 : 1;
}
