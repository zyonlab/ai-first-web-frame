import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  booleanFlag,
  parseCliArgs,
  stringFlag,
} from "../platform/fragment-registry/src/cli";
import {
  addComposeService,
  nextFragmentPort,
} from "../platform/fragment-registry/src/compose";
import {
  applyRegisterFragment,
  loadRegistryData,
  type RegisterFragmentInput,
  saveRegistryData,
} from "../platform/fragment-registry/src/mutations";

type RegisterResult = {
  status: "registered" | "failed";
  name: string;
  version?: string;
  channel?: string;
  action?: "added" | "updated" | "unchanged";
  compose?: { service: string; port: number; action: "added" | "unchanged" };
  files: string[];
  error?: string;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = join(
  root,
  "platform/fragment-registry/src/registry.data.json",
);
const composePath = join(root, "infra/docker/docker-compose.yml");

function run(argv: string[]): RegisterResult {
  const args = parseCliArgs(argv);
  const name = stringFlag(args, "name") ?? "";
  const version = stringFlag(args, "version") ?? "";
  const serviceUrl = stringFlag(args, "service-url") ?? "";

  if (!name || !version || !serviceUrl) {
    return {
      status: "failed",
      name,
      files: [],
      error:
        "usage: register-fragment --name <kebab-name> --version <semver> --service-url <url> [--manifest-url <url>] [--channel stable|canary|preview] [--port <n>] [--with-compose]",
    };
  }

  const input: RegisterFragmentInput = {
    name,
    version,
    serviceUrl,
    manifestUrl: stringFlag(args, "manifest-url"),
    channel: (stringFlag(args, "channel") ??
      "canary") as RegisterFragmentInput["channel"],
  };

  try {
    const files: string[] = [];
    const result = applyRegisterFragment(loadRegistryData(registryPath), input);
    if (result.changed) {
      saveRegistryData(registryPath, result.registry);
      files.push(relative(root, registryPath));
    }

    let compose: RegisterResult["compose"];
    if (booleanFlag(args, "with-compose")) {
      if (!existsSync(composePath))
        throw new Error(`compose file not found: ${composePath}`);
      const composeText = readFileSync(composePath, "utf8");
      const port = resolvePort(args.flags.port, serviceUrl, composeText);
      const mutation = addComposeService(composeText, { name, port });
      if (mutation.changed) {
        writeFileSync(composePath, mutation.text);
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
