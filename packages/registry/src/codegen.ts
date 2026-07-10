import { PageManifestSchema } from "@mvp/contracts";

/**
 * Manifest -> runtime-wiring codegen (refactor plan §3.2): the pure transform
 * that turns a page's `manifest.slots.json` into the source of
 * `apps/<page>/src/fragmentSlots.gen.ts`. `scripts/mount-slot.mts` runs this
 * after every successful mount/unmount and in `--check` mode (no writes) to
 * prove the generated file never drifts from the manifest.
 *
 * Kept side-effect free and formatter-agnostic on purpose: the caller is
 * responsible for running the result through the project formatter (biome)
 * before writing or diffing, so both the "write" and "--check" code paths
 * compare the exact same canonical text.
 */

const SlotSchema = PageManifestSchema.shape.slots.element;
// `.passthrough()` so a `reserved: true` marker (a hand-rendered-placeholder
// convention layered on top of the base schema by `packages/registry/src/slots.ts`)
// survives parsing and can be filtered out below.
const SlotPassthroughSchema = SlotSchema.passthrough();

export type GenerableManifestSlot = ReturnType<typeof SlotSchema.parse> & {
  reserved?: boolean;
};

// Mirrors `@mvp/runtime`'s `FragmentSlotDefinition` field order so the
// generated object literals read the same way the hand-written ones used to.
const FIELD_ORDER: Array<keyof GenerableManifestSlot> = [
  "name",
  "fragment",
  "channel",
  "strategy",
  "timeoutMs",
  "props",
  "staticHtml",
  "cachePolicy",
  "dependsOn",
  "dataDependencies",
  "required",
];

export class InvalidManifestSlotsError extends Error {}

/**
 * Generates the (unformatted) TypeScript source for a page's
 * `fragmentSlots.gen.ts`. Every slot is parsed through the same
 * `PageManifestSchema` slot contract `mount-slot` writes through — an
 * invalid manifest fails loudly instead of generating bad code. Slots marked
 * `reserved: true` (hand-rendered placeholders, refactor plan §3.4) are
 * intentionally excluded: they are never wired into the runtime slots array.
 */
export function generateFragmentSlotsSource(
  page: string,
  manifestSlots: unknown,
): string {
  if (!Array.isArray(manifestSlots)) {
    throw new InvalidManifestSlotsError(
      `manifest slots for page "${page}" must be an array`,
    );
  }

  const slots = manifestSlots
    .map((raw, index) => {
      const result = SlotPassthroughSchema.safeParse(raw);
      if (!result.success) {
        throw new InvalidManifestSlotsError(
          `manifest slots[${index}] for page "${page}" is invalid: ${result.error.issues
            .map((issue) => issue.message)
            .join("; ")}`,
        );
      }
      return result.data as GenerableManifestSlot;
    })
    .filter((slot) => slot.reserved !== true)
    .map(orderedEntries);

  const arrayLiteral =
    slots.length === 0
      ? "[]"
      : `[\n${slots
          .map((entry) => indent(JSON.stringify(entry, null, 2), 2))
          .join(",\n")}\n]`;

  return [
    "/**",
    " * GENERATED FILE — do not edit by hand.",
    ` * Source of truth: apps/${page}/src/manifest.slots.json`,
    " * Regenerate after any manifest edit:",
    ` *   pnpm exec tsx scripts/mount-slot.mts --page ${page} --slot <name> --fragment <fragment> [...flags]`,
    " * Freshness check (wired into `pnpm verify:manifest-gen`):",
    ` *   pnpm exec tsx scripts/mount-slot.mts --page ${page} --check`,
    " */",
    "",
    'import type { FragmentSlotDefinition } from "@mvp/runtime";',
    "",
    `export const fragmentSlots: FragmentSlotDefinition[] = ${arrayLiteral};`,
    "",
  ].join("\n");
}

function orderedEntries(slot: GenerableManifestSlot): Record<string, unknown> {
  const entry: Record<string, unknown> = {};
  for (const key of FIELD_ORDER) {
    const value = slot[key];
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    entry[key] = value;
  }
  return entry;
}

function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export type GenFileFreshness =
  | { status: "fresh" }
  | { status: "stale"; expected: string; actual: string | null };

/**
 * Pure staleness comparison used by `mount-slot --check`: "fresh" iff the
 * on-disk gen file is byte-identical to what `generateFragmentSlotsSource`
 * (run through the project formatter) would produce right now. A missing
 * file (`actual === null`) is always stale.
 */
export function checkFragmentSlotsGenFileFreshness(
  expectedSource: string,
  actualSource: string | null,
): GenFileFreshness {
  if (actualSource === expectedSource) return { status: "fresh" };
  return { status: "stale", expected: expectedSource, actual: actualSource };
}
