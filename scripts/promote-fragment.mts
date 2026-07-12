import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isRetryableWriteError } from "../packages/registry/src/atomic-file";
import {
  parseCliArgs,
  stringFlag,
  unknownFlagError,
} from "../packages/registry/src/cli";
import {
  applyPromoteFragment,
  loadRegistryData,
  loadReleases,
  saveRegistryData,
  saveReleases,
} from "../packages/registry/src/mutations";

type PromoteResult = {
  status: "promoted" | "unchanged" | "failed" | "conflict";
  name: string;
  from?: string;
  to?: string;
  files: string[];
  error?: string;
  retry?: boolean;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = join(root, "registry/registry.data.json");
const releasesPath = join(root, "registry/releases.json");

/** Allowlist for `unknownFlagError` (L3): a typo'd flag fails, no writes. */
const KNOWN_FLAGS = ["name"] as const;

function run(argv: string[]): PromoteResult {
  const args = parseCliArgs(argv);
  const name = stringFlag(args, "name") ?? args.positional[0] ?? "";
  const flagError = unknownFlagError(args, KNOWN_FLAGS);
  if (flagError) {
    return { status: "failed", name, files: [], error: flagError };
  }
  if (!name) {
    return {
      status: "failed",
      name,
      files: [],
      error: "usage: promote-fragment --name <fragment-name>",
    };
  }

  try {
    const registry = loadRegistryData(registryPath);
    const result = applyPromoteFragment(registry.data, name);
    if (!result.changed || !result.release) {
      return { status: "unchanged", name, files: [] };
    }
    saveRegistryData(registryPath, result.registry, registry.hash);
    const releases = loadReleases(releasesPath);
    releases.data.releases.push(result.release);
    saveReleases(releasesPath, releases.data, releases.hash);
    return {
      status: "promoted",
      name,
      from: result.release.rollbackTo,
      to: result.release.version,
      files: [relative(root, registryPath), relative(root, releasesPath)],
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

const result = run(process.argv.slice(2));
console.log(JSON.stringify(result, null, 2));
process.exitCode =
  result.status === "failed" || result.status === "conflict" ? 1 : 0;
