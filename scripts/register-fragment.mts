import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isRetryableWriteError,
  loadFileWithHash,
  writeFileAtomic,
} from "../packages/registry/src/atomic-file";
import {
  booleanFlag,
  parseCliArgs,
  stringFlag,
  unknownFlagError,
} from "../packages/registry/src/cli";
import {
  addComposeService,
  nextFragmentPort,
} from "../packages/registry/src/compose";
import {
  applyRegisterFragment,
  loadRegistryData,
  type RegisterFragmentInput,
  saveRegistryData,
} from "../packages/registry/src/mutations";

type RegisterResult = {
  status: "registered" | "failed" | "conflict";
  name: string;
  version?: string;
  channel?: string;
  action?: "added" | "updated" | "unchanged";
  compose?: { service: string; port: number; action: "added" | "unchanged" };
  files: string[];
  error?: string;
  retry?: boolean;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = join(root, "registry/registry.data.json");
const composePath = join(root, "infra/docker/docker-compose.yml");

/** Allowlist for `unknownFlagError` (L3): a typo'd flag fails, no writes. */
const KNOWN_FLAGS = [
  "name",
  "version",
  "service-url",
  "manifest-url",
  "assets-url",
  "channel",
  "port",
  "with-compose",
] as const;

function run(argv: string[]): RegisterResult {
  const args = parseCliArgs(argv);
  const name = stringFlag(args, "name") ?? "";
  const flagError = unknownFlagError(args, KNOWN_FLAGS);
  if (flagError) {
    return { status: "failed", name, files: [], error: flagError };
  }
  const version = stringFlag(args, "version") ?? "";
  const serviceUrl = stringFlag(args, "service-url") ?? "";

  if (!name || !version || !serviceUrl) {
    return {
      status: "failed",
      name,
      files: [],
      error:
        "usage: register-fragment --name <kebab-name> --version <semver> --service-url <url> [--manifest-url <url>] [--assets-url <url>] [--channel stable|canary|preview] [--port <n>] [--with-compose]",
    };
  }

  const input: RegisterFragmentInput = {
    name,
    version,
    serviceUrl,
    manifestUrl: stringFlag(args, "manifest-url"),
    // Optional runtime island asset URL (C3 spike, §4.3.3) — a fragment's
    // browser-loadable island module, dynamically `import()`-able via an
    // import map instead of a build-time static import.
    assetsUrl: stringFlag(args, "assets-url"),
    channel: (stringFlag(args, "channel") ??
      "canary") as RegisterFragmentInput["channel"],
  };

  try {
    const files: string[] = [];
    const registry = loadRegistryData(registryPath);
    const result = applyRegisterFragment(registry.data, input);
    if (result.changed) {
      saveRegistryData(registryPath, result.registry, registry.hash);
      files.push(relative(root, registryPath));
    }

    let compose: RegisterResult["compose"];
    if (booleanFlag(args, "with-compose")) {
      const composeFile = loadFileWithHash(composePath);
      if (composeFile.content === null)
        throw new Error(`compose file not found: ${composePath}`);
      const port = resolvePort(
        args.flags.port,
        serviceUrl,
        composeFile.content,
      );
      const mutation = addComposeService(composeFile.content, { name, port });
      if (mutation.changed) {
        writeFileAtomic(composePath, mutation.text, {
          expectedHash: composeFile.hash,
        });
        files.push(relative(root, composePath));
      }
      compose = {
        service: name,
        port,
        action: mutation.changed ? "added" : "unchanged",
      };
    }

    return {
      status: "registered",
      name,
      version,
      channel: input.channel,
      action: result.action,
      ...(compose ? { compose } : {}),
      files,
    };
  } catch (error) {
    if (isRetryableWriteError(error)) {
      return {
        status: "conflict",
        name,
        files: [],
        error: error.message,
        retry: true,
      };
    }
    return {
      status: "failed",
      name,
      files: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolvePort(
  portFlag: string | boolean | undefined,
  serviceUrl: string,
  composeText: string,
): number {
  if (typeof portFlag === "string" && portFlag.length > 0) {
    const port = Number(portFlag);
    if (!Number.isInteger(port) || port <= 0)
      throw new Error(`--port "${portFlag}" is not a valid port`);
    return port;
  }
  try {
    const urlPort = new URL(serviceUrl).port;
    if (urlPort) return Number(urlPort);
  } catch {
    // fall through to the port scan
  }
  return nextFragmentPort(composeText);
}

const result = run(process.argv.slice(2));
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === "registered" ? 0 : 1;
