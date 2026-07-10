import { spawnSync } from "node:child_process";
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
import { generateFragmentSlotsSource } from "../packages/registry/src/codegen";
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
  status:
    | "mounted"
    | "removed"
    | "unchanged"
    | "fresh"
    | "stale"
    | "failed"
    | "conflict";
  page: string;
  slot: string;
  action?: "added" | "updated" | "unchanged" | "removed";
  files: string[];
  warnings: string[];
  error?: string;
  retry?: boolean;
};

const USAGE =
  "usage: mount-slot --page <page-home|page-product> --slot <name> --fragment <fragment> " +
  "[--strategy static|ttl-cache|cached-ssr|dynamic-ssr] [--channel stable|canary|preview] " +
  "[--timeout-ms <n>] [--props <json>] [--static-html <string>] [--cache-policy <json>] " +
  "[--data-dependencies <json-array>] [--required] [--allow-unregistered] " +
  "| mount-slot --page <page> --slot <name> --remove " +
  "| mount-slot --page <page> --check (verifies fragmentSlots.gen.ts is in sync with manifest.slots.json, writes nothing)";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = join(root, "registry/registry.data.json");

async function run(argv: string[]): Promise<MountResult> {
  const args = parseCliArgs(argv);
  const page = stringFlag(args, "page") ?? "";
  const slotName = stringFlag(args, "slot") ?? "";
  const remove = booleanFlag(args, "remove");
  const fragment = stringFlag(args, "fragment") ?? "";
  const allowUnregistered = booleanFlag(args, "allow-unregistered");
  const check = booleanFlag(args, "check");

  if (!page || (!check && (!slotName || (!remove && !fragment)))) {
    return {
      status: "failed",
      page,
      slot: slotName,
      files: [],
      warnings: [],
      error: USAGE,
    };
  }

  try {
    const slotsPath = resolveSlotsPath(page);
    const slotsFile = loadFileWithHash(slotsPath);
    if (slotsFile.content === null)
      throw new Error(`slots file vanished: ${relative(root, slotsPath)}`);
    const currentSlots = JSON.parse(slotsFile.content) as unknown[];

    // `--check` mode (refactor plan §3.2): a pure freshness check against the
    // manifest already on disk. It never mutates `manifest.slots.json` and
    // never writes `fragmentSlots.gen.ts` — this is what
    // `pnpm verify:manifest-gen` runs in CI so a stale generated file fails
    // the same way a lint error would. --slot/--fragment/etc. are accepted
    // but unused here (so the same invocation shape used to mount a slot can
    // be reused with --check appended to sanity-check the result).
    if (check) {
      const genPath = resolveGenPath(page);
      const expected = formatWithBiome(
        generateFragmentSlotsSource(page, currentSlots),
        genPath,
      );
      const genFile = loadFileWithHash(genPath);
      const fresh = genFile.content === expected;
      return {
        status: fresh ? "fresh" : "stale",
        page,
        slot: slotName,
        files: [],
        warnings: [],
        ...(fresh
          ? {}
          : {
              error: `${relative(root, genPath)} is stale relative to ${relative(root, slotsPath)}; regenerate by rerunning mount-slot without --check`,
            }),
      };
    }

    const warnings: string[] = [];

    if (!remove) {
      // Mount gate: an unregistered fragment is an error unless the caller
      // explicitly opted into the legacy warn-and-proceed behavior.
      const registry = loadRegistryData(registryPath);
      const registeredCheck = checkFragmentRegistered(
        registry.data,
        fragment,
        allowUnregistered,
      );
      if (!registeredCheck.ok) {
        return {
          status: "failed",
          page,
          slot: slotName,
          files: [],
          warnings: [],
          error: registeredCheck.error,
        };
      }
      warnings.push(...registeredCheck.warnings);
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
      ? applyUnmountSlot(currentSlots, slotName)
      : applyMountSlot(currentSlots, buildSlot(args.flags, slotName, fragment));

    const files: string[] = [];
    if (mutation.changed) {
      const formattedSlots = formatWithBiome(
        `${JSON.stringify(mutation.slots, null, 2)}\n`,
        slotsPath,
      );
      writeFileAtomic(slotsPath, formattedSlots, {
        expectedHash: slotsFile.hash,
      });
      files.push(relative(root, slotsPath));
    }

    // Codegen step (refactor plan §3.2): regenerate `fragmentSlots.gen.ts`
    // from the post-mutation manifest state, regardless of whether the
    // manifest write itself changed anything — this backfills the gen file
    // the first time a page's slots are already correct, and keeps it in
    // sync afterward. Only actually written when its content differs.
    const genPath = resolveGenPath(page);
    const expectedGen = formatWithBiome(
      generateFragmentSlotsSource(page, mutation.slots),
      genPath,
    );
    const genFile = loadFileWithHash(genPath);
    if (genFile.content !== expectedGen) {
      writeFileAtomic(genPath, expectedGen, { expectedHash: genFile.hash });
      files.push(relative(root, genPath));
    }

    return {
      status: mutation.changed ? (remove ? "removed" : "mounted") : "unchanged",
      page,
      slot: slotName,
      action: mutation.action,
      files,
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

function resolvePageName(page: string): string {
  return page.replace(/^@mvp\//, "");
}

function resolveSlotsPath(page: string): string {
  const name = resolvePageName(page);
  const path = join(root, "apps", name, "src", "manifest.slots.json");
  if (!existsSync(path))
    throw new Error(
      `page "${page}" has no slots data file (expected ${relative(root, path)})`,
    );
  return path;
}

function resolveGenPath(page: string): string {
  const name = resolvePageName(page);
  return join(root, "apps", name, "src", "fragmentSlots.gen.ts");
}

/**
 * Runs generated/serialized content through the project formatter (biome) so
 * both the "write" and "--check" code paths compare/produce the exact same
 * canonical text `pnpm check` expects — the codegen module and the plain
 * `JSON.stringify` slots write both stay formatter-agnostic.
 */
function formatWithBiome(source: string, absolutePath: string): string {
  const relPath = relative(root, absolutePath);
  const result = spawnSync(
    "pnpm",
    ["exec", "biome", "format", `--stdin-file-path=${relPath}`],
    { cwd: root, input: source, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `biome format failed for ${relPath}: ${result.stderr || result.stdout || `exit ${result.status}`}`,
    );
  }
  return result.stdout;
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
  if (typeof flags["static-html"] === "string")
    slot.staticHtml = flags["static-html"];
  if (typeof flags["cache-policy"] === "string")
    slot.cachePolicy = JSON.parse(flags["cache-policy"]);
  if (typeof flags["data-dependencies"] === "string")
    slot.dataDependencies = JSON.parse(flags["data-dependencies"]);
  if (typeof flags["depends-on"] === "string")
    slot.dependsOn = JSON.parse(flags["depends-on"]);
  slot.required = flags.required === true || flags.required === "true";
  return slot as PageSlot;
}

const result = await run(process.argv.slice(2));
console.log(JSON.stringify(result, null, 2));
process.exitCode =
  result.status === "failed" ||
  result.status === "conflict" ||
  result.status === "stale"
    ? 1
    : 0;
