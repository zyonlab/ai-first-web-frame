import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * `cn` — the frozen class-merge convention for every vendored shadcn primitive
 * (doc 04 §4.3). `clsx` resolves conditional/array/object class inputs, then
 * `tailwind-merge` de-duplicates conflicting Tailwind utilities so a caller's
 * `className` override always wins over the component's base classes.
 *
 * This is the ONLY place `clsx` + `tailwind-merge` are combined; primitives and
 * their `cva` `variants` compose token-backed utility strings and hand the
 * result to `cn`. Utilities resolve to `var(--mvp-*)` via the design-system
 * Tailwind preset, so no hard-coded colors ever appear in a primitive.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
