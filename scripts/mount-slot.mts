import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  booleanFlag,
  parseCliArgs,
  stringFlag,
} from "../platform/fragment-registry/src/cli";
import { loadRegistryData } from "../platform/fragment-registry/src/mutations";
import {
  applyMountSlot,
  applyUnmountSlot,
  type PageSlot,
} from "../platform/fragment-registry/src/slots";

type MountResult = {
  status: "mounted" | "removed" | "unchanged" | "failed";
  page: string;
  slot: string;
  action?: "added" | "updated" | "unchanged" | "removed";
  files: string[];
  warnings: string[];
  error?: string;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = join(
  root,
  "platform/fragment-registry/src/registry.data.json",
);

function run(argv: string[]): MountResult {
  const args = parseCliArgs(argv);
  const page = stringFlag(args, "page") ?? "";
  const slotName = stringFlag(args, "slot") ?? "";
  const remove = booleanFlag(args, "remove");
  const fragment = stringFlag(args, "fragment") ?? "";

  if (!page || !slotName || (!remove && !fragment)) {
    return {
      status: "failed",
      page,
      slot: slotName,
      files: [],
      warnings: [],
      error:
        "usage: mount-slot --page <page-home|page-product> --slot <name> --fragment <fragment> [--strategy static|ssg|isr|cached-ssr|dynamic-ssr] [--channel stable|canary|preview] [--timeout-ms <n>] [--props <json>] [--required] | mount-slot --page <page> --slot <name> --remove",
    };
  }

  try {
    const slotsPath = resolveSlotsPath(page);
    const slots = JSON.parse(readFileSync(slotsPath, "utf8")) as unknown[];
    const warnings: string[] = [];

    const mutation = remove
      ? applyUnmountSlot(slots, slotName)
      : applyMountSlot(slots, buildSlot(args.flags, slotName, fragment));

    if (!remove) {
      const registry = loadRegistryData(registryPath);
      if (!registry.fragments[fragment]) {
        warnings.push(
          `fragment "${fragment}" is not in the fragment registry; run register-fragment first unless the slot is static or reserved`,
        );
      }
    }

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

    writeFileSync(slotsPath, `${JSON.stringify(mutation.slots, null, 2)}\n`);
    return {
      status: remove ? "removed" : "mounted",
      page,
      slot: slotName,
      action: mutation.action,
      files: [relative(root, slotsPath)],
      warnings,
    };
  } catch (error) {
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

const result = run(process.argv.slice(2));
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === "failed" ? 1 : 0;
