import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCliArgs,
  stringFlag,
} from "../platform/fragment-registry/src/cli";
import {
  applyPromoteFragment,
  loadRegistryData,
  loadReleases,
  saveRegistryData,
  saveReleases,
} from "../platform/fragment-registry/src/mutations";

type PromoteResult = {
  status: "promoted" | "unchanged" | "failed";
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

function run(argv: string[]): PromoteResult {
  const args = parseCliArgs(argv);
  const name = stringFlag(args, "name") ?? args.positional[0] ?? "";
  if (!name) {
    return {
      status: "failed",
      name,
      files: [],
      error: "usage: promote-fragment --name <fragment-name>",
    };
  }

  try {
    const result = applyPromoteFragment(loadRegistryData(registryPath), name);
    if (!result.changed || !result.release) {
      return { status: "unchanged", name, files: [] };
    }
    saveRegistryData(registryPath, result.registry);
    const releases = loadReleases(releasesPath);
    releases.releases.push(result.release);
    saveReleases(releasesPath, releases);
    return {
      status: "promoted",
      name,
      from: result.release.rollbackTo,
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
