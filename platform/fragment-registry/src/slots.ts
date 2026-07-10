import {
  type PageManifest,
  PageManifestSchema,
} from "../../../packages/contracts/src/index";
import type { FragmentSlotDefinition } from "../../../packages/runtime/src/index";

export type PageSlot = PageManifest["slots"][number];

export type SlotsMutation = {
  slots: unknown[];
  changed: boolean;
  action: "added" | "updated" | "unchanged" | "removed";
};

const SlotSchema = PageManifestSchema.shape.slots.element;
const SlotPassthroughSchema = SlotSchema.passthrough();

export function validatePageSlots(slots: unknown): {
  valid: boolean;
  errors: string[];
} {
  if (!Array.isArray(slots))
    return { valid: false, errors: ["slots must be an array"] };
  const errors = slots.flatMap((slot, index) => {
    const result = SlotPassthroughSchema.safeParse(slot);
    if (result.success) return [];
    return result.error.issues.map(
      (issue) =>
        `slots[${index}]${issue.path.length > 0 ? `.${issue.path.join(".")}` : ""}: ${issue.message}`,
    );
  });
  return { valid: errors.length === 0, errors };
}

export function applyMountSlot(
  slots: unknown[],
  slot: PageSlot,
): SlotsMutation {
  const parsed = SlotSchema.parse(slot);
  const normalized = pruneUndefined(parsed as Record<string, unknown>);
  const index = slots.findIndex(
    (candidate) => isRecord(candidate) && candidate.name === normalized.name,
  );

  if (index >= 0 && deepEqual(slots[index], normalized))
    return { slots: [...slots], changed: false, action: "unchanged" };

  const next = [...slots];
  if (index >= 0) next[index] = normalized;
  else next.push(normalized);

  const validation = validatePageSlots(next);
  if (!validation.valid)
    throw new Error(
      `mounted slots are invalid: ${validation.errors.join("; ")}`,
    );

  return {
    slots: next,
    changed: true,
    action: index >= 0 ? "updated" : "added",
  };
}

export type FragmentRegistrationCheck =
  | { ok: true; warnings: string[] }
  | { ok: false; error: string };

/**
 * Mount gate (refactor plan §3.5, goal A3): a fragment absent from the
 * registry is an error unless the caller explicitly opts into the legacy
 * warn-and-proceed behavior with --allow-unregistered.
 */
export function checkFragmentRegistered(
  registry: { fragments: Record<string, unknown> },
  fragment: string,
  allowUnregistered: boolean,
): FragmentRegistrationCheck {
  if (registry.fragments[fragment]) return { ok: true, warnings: [] };
  if (allowUnregistered)
    return {
      ok: true,
      warnings: [
        `fragment "${fragment}" is not in the fragment registry; proceeding because --allow-unregistered was passed`,
      ],
    };
  return {
    ok: false,
    error: `fragment "${fragment}" is not in the fragment registry; run register-fragment (scripts/register-fragment.mts) first, or pass --allow-unregistered to mount it anyway`,
  };
}

/**
 * Declarative subset of `@mvp/runtime`'s `FragmentSlotDefinition` that the
 * manifest can meaningfully be cross-checked against (refactor plan §3.4:
 * `manifest.slots.json` neither drives nor validates the hand-wired runtime
 * slots array, so the two silently drift — this is the shape both sides are
 * compared through).
 */
export type RuntimeSlotContract = Pick<
  FragmentSlotDefinition,
  "name" | "fragment" | "channel" | "strategy" | "timeoutMs" | "required"
>;

// Mirrors the defaults `packages/runtime/src/index.ts` applies when a slot
// field is omitted (see `fetchFragmentSlot`'s `strategy ?? "dynamic-ssr"` /
// `channel ?? "stable"` / `required ?? false`, and `executeFragmentSlots`'s
// `timeoutMs = 200` parameter default that every page fetcher forwards
// per-slot). Keep in sync with that file if its defaults ever change.
const RUNTIME_DEFAULT_CHANNEL = "stable";
const RUNTIME_DEFAULT_STRATEGY = "dynamic-ssr";
const RUNTIME_DEFAULT_REQUIRED = false;
const RUNTIME_DEFAULT_TIMEOUT_MS = 200;

type DriftComparableField =
  | "fragment"
  | "channel"
  | "strategy"
  | "timeoutMs"
  | "required";

/**
 * Cross-check a page's declarative `manifest.slots.json` against the actual
 * runtime slots array it wires into `executeFragmentSlots`/`fetchFragmentSlots`
 * (refactor plan §3.4). Pure and side-effect free; returns human-readable
 * drift messages, or an empty array when the two sides are in sync.
 *
 * Rules:
 * - A manifest slot marked `reserved: true` is a hand-rendered placeholder
 *   and must NOT appear in the runtime array; if it does, that's drift.
 * - Every other manifest slot must have a matching runtime entry (name,
 *   fragment, channel, strategy, timeoutMs, required), comparing values
 *   after applying the same defaults the runtime applies for omitted fields.
 * - A runtime slot with no corresponding manifest entry is also drift.
 */
export function diffManifestAgainstRuntime(
  manifestSlots: unknown,
  runtimeSlots: RuntimeSlotContract[],
): string[] {
  if (!Array.isArray(manifestSlots)) return ["manifest slots must be an array"];

  const drift: string[] = [];
  const runtimeByName = new Map(
    runtimeSlots.map((slot) => [slot.name, slot] as const),
  );
  const manifestNames = new Set<string>();

  for (const [index, candidate] of manifestSlots.entries()) {
    const parsed = SlotPassthroughSchema.safeParse(candidate);
    if (!parsed.success) {
      drift.push(
        `manifest slots[${index}] is invalid: ${parsed.error.issues
          .map((issue) => issue.message)
          .join("; ")}`,
      );
      continue;
    }
    const manifestSlot = parsed.data as PageSlot & { reserved?: boolean };
    manifestNames.add(manifestSlot.name);
    const runtimeSlot = runtimeByName.get(manifestSlot.name);
    const isReserved = manifestSlot.reserved === true;

    if (isReserved) {
      if (runtimeSlot) {
        drift.push(
          `slot "${manifestSlot.name}" is marked reserved in the manifest (hand-rendered placeholder) but is also wired into the runtime slots array`,
        );
      }
      continue;
    }

    if (!runtimeSlot) {
      drift.push(
        `slot "${manifestSlot.name}" is declared in the manifest but missing from the runtime slots array`,
      );
      continue;
    }

    const fields: Array<{
      key: DriftComparableField;
      manifestValue: unknown;
      runtimeValue: unknown;
    }> = [
      {
        key: "fragment",
        manifestValue: manifestSlot.fragment,
        runtimeValue: runtimeSlot.fragment,
      },
      {
        key: "channel",
        manifestValue: manifestSlot.channel ?? RUNTIME_DEFAULT_CHANNEL,
        runtimeValue: runtimeSlot.channel ?? RUNTIME_DEFAULT_CHANNEL,
      },
      {
        key: "strategy",
        manifestValue: manifestSlot.strategy ?? RUNTIME_DEFAULT_STRATEGY,
        runtimeValue: runtimeSlot.strategy ?? RUNTIME_DEFAULT_STRATEGY,
      },
      {
        key: "timeoutMs",
        manifestValue: manifestSlot.timeoutMs ?? RUNTIME_DEFAULT_TIMEOUT_MS,
        runtimeValue: runtimeSlot.timeoutMs ?? RUNTIME_DEFAULT_TIMEOUT_MS,
      },
      {
        key: "required",
        manifestValue: manifestSlot.required ?? RUNTIME_DEFAULT_REQUIRED,
        runtimeValue: runtimeSlot.required ?? RUNTIME_DEFAULT_REQUIRED,
      },
    ];

    for (const field of fields) {
      if (field.manifestValue !== field.runtimeValue) {
        drift.push(
          `slot "${manifestSlot.name}" ${field.key} mismatch: manifest=${JSON.stringify(field.manifestValue)} runtime=${JSON.stringify(field.runtimeValue)}`,
        );
      }
    }
  }

  for (const runtimeSlot of runtimeSlots) {
    if (!manifestNames.has(runtimeSlot.name)) {
      drift.push(
        `slot "${runtimeSlot.name}" is wired into the runtime slots array but missing from the manifest`,
      );
    }
  }

  return drift;
}

export function applyUnmountSlot(
  slots: unknown[],
  name: string,
): SlotsMutation {
  const next = slots.filter(
    (candidate) => !(isRecord(candidate) && candidate.name === name),
  );
  const changed = next.length !== slots.length;
  return { slots: next, changed, action: changed ? "removed" : "unchanged" };
}

function pruneUndefined(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
