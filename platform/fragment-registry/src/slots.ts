import {
  type PageManifest,
  PageManifestSchema,
} from "../../../packages/contracts/src/index";

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
