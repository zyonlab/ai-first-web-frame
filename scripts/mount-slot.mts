import { existsSync } from "node:fs";
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
} from "../packages/registry/src/cli";
import { loadRegistryData } from "../packages/registry/src/mutations";
import {
  applyMountSlot,
  applyUnmountSlot,
  checkFragmentRegistered,
  type PageSlot,
} from "../packages/registry/src/slots";
import { layoutAdvisories } from "../tools/release-tools/src/layout-advisories.ts";
import { loadFragmentManifest } from "../tools/release-tools/src/load-graph.ts";

type MountResult = {
  status: "mounted" | "removed" | "unchanged" | "failed" | "conflict";
  page: string;
  slot: string;
  action?: "added" | "updated" | "unchanged" | "removed";
  files: string[];
  warnings: string[];
  error?: string;
  retry?: boolean;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = join(root, "registry/registry.data.json");

async function run(argv: string[]): Promise<MountResult> {
  const args = parseCliArgs(argv);
  const page = stringFlag(args, "page") ?? "";
  const slotName = stringFlag(args, "slot") ?? "";
  const remove = booleanFlag(args, "remove");
  const fragment = stringFlag(args, "fragment") ?? "";
  const allowUnregistered = booleanFlag(args, "allow-unregistered");

  if (!page || !slotName || (!remove && !fragment)) {
    return {
      status: "failed",
      page,
      slot: slotName,
      files: [],
      warnings: [],
      error:
        "usage: mount-slot --page <page-home|page-product> --slot <name> --fragment <fragment> [--strategy static|ssg|isr|cached-ssr|dynamic-ssr] [--channel stable|canary|preview] [--timeout-ms <n>] [--props <json>] [--required] [--allow-unregistered] | mount-slot --page <page> --slot <name> --remove",
    };
  }

  try {
    const slotsPath = resolveSlotsPath(page);
    const slotsFile = loadFileWithHash(slotsPath);
    if (slotsFile.content === null)
      throw new Error(`slots file vanished: ${relative(root, slotsPath)}`);
    const slots = JSON.parse(slotsFile.content) as unknown[];
    const warnings: string[] = [];

    if (!remove) {
      // Mount gate: an unregistered fragment is an error unless the caller
      // explicitly opted into the legacy warn-and-proceed behavior.
      const registry = loadRegistryData(registryPath);
      const check = checkFragmentRegistered(
        registry.data,
        fragment,
        allowUnregistered,
      );
      if (!check.ok) {
        return {
          status: "failed",
          page,
          slot: slotName,
          files: [],
          warnings: [],
          error: check.error,
        };
      }
      warnings.push(...check.warnings);
      // Layout contract: the pane can't be measured here, but the fragment's
      // manifest layoutHint tells the author what the slot must provide.
      const manifest = await loadFragmentManifest(root, fragment);
      if (manifest) {
        warnings.push(
          ...layoutAdvisories(manifest.layoutHint, {
            fragment,
            slot: slotName,
          }),
        );
      }
    }

    const mutation = remove
      ? applyUnmountSlot(slots, slotName)
      : applyMountSlot(slots, buildSlot(args.flags, slotName, fragment));

    if (!mutation.changed) {
      return {
        status: "unchanged",
        page,
        slot: slotName,
        action: mutation.action,
        files: [],
        warnings,
      };
    }

    writeFileAtomic(slotsPath, `${JSON.stringify(mutation.slots, null, 2)}\n`, {
      expectedHash: slotsFile.hash,
    });
    return {
      status: remove ? "removed" : "mounted",
      page,
      slot: slotName,
      action: mutation.action,
      files: [relative(root, slotsPath)],
      warnings,
    };
  } catch (error) {
    if (isRetryableWriteError(error)) {
      return {
        status: "conflict",
        page,
        slot: slotName,
        files: [],
        warnings: [],
        error: error.message,
        retry: true,
      };
    }
    return {
      status: "failed",
      page,
      slot: slotName,
      files: [],
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveSlotsPath(page: string): string {
  const name = page.replace(/^@mvp\//, "");
  const path = join(root, "apps", name, "src", "manifest.slots.json");
  if (!existsSync(path))
    throw new Error(
      `page "${page}" has no slots data file (expected ${relative(root, path)})`,
    );
  return path;
}

function buildSlot(
  flags: Record<string, string | boolean>,
  name: string,
  fragment: string,
): PageSlot {
  const slot: Record<string, unknown> = { name, fragment };
  if (typeof flags.channel === "string") slot.channel = flags.channel;
  else slot.channel = "stable";
  if (typeof flags.strategy === "string") slot.strategy = flags.strategy;
  if (typeof flags["timeout-ms"] === "string") {
    const timeoutMs = Number(flags["timeout-ms"]);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0)
      throw new Error(`--timeout-ms "${flags["timeout-ms"]}" is invalid`);
    slot.timeoutMs = timeoutMs;
  }
  if (typeof flags.props === "string") slot.props = JSON.parse(flags.props);
  slot.required = flags.required === true || flags.required === "true";
  return slot as PageSlot;
}

const result = await run(process.argv.slice(2));
console.log(JSON.stringify(result, null, 2));
process.exitCode =
  result.status === "failed" || result.status === "conflict" ? 1 : 0;
