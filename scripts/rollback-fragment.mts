import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCliArgs,
  stringFlag,
} from "../platform/fragment-registry/src/cli";
import {
  applyRollbackFragment,
  loadRegistryData,
  loadReleases,
  saveRegistryData,
  saveReleases,
} from "../platform/fragment-registry/src/mutations";

type RollbackResult = {
  status: "rolled-back" | "unchanged" | "failed";
  name: string;
  from?: string;
  to?: string;
  files: string[];
  error?: string;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = join(
  root,
  "platform/fragment-registry/src/registry.data.json",
);
const releasesPath = join(root, "platform/fragment-registry/releases.json");

function run(argv: string[]): RollbackResult {
  const args = parseCliArgs(argv);
  const name = stringFlag(args, "name") ?? args.positional[0] ?? "";
  if (!name) {
    return {
      status: "failed",
      name,
      files: [],
      error: "usage: rollback-fragment --name <fragment-name> [--to <version>]",
    };
  }

  try {
    const registry = loadRegistryData(registryPath);
    const from = registry.fragments[name]?.stable?.version;
    const releases = loadReleases(releasesPath);
    const result = applyRollbackFragment(
      registry,
      releases.releases,
      name,
      stringFlag(args, "to"),
    );
    if (!result.changed || !result.release) {
      return { status: "unchanged", name, files: [] };
    }
    saveRegistryData(registryPath, result.registry);
    releases.releases.push(result.release);
    saveReleases(releasesPath, releases);
    return {
      status: "rolled-back",
      name,
      from,
      to: result.release.version,
      files: [relative(root, registryPath), relative(root, releasesPath)],
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

const result = run(process.argv.slice(2));
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === "failed" ? 1 : 0;
