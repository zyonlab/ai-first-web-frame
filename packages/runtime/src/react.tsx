import type { FragmentRenderResponse } from "@mvp/contracts";
import type { ReactNode } from "react";
import type { FragmentSlotResult, FragmentSlotsExecution } from "./index";

/**
 * `<FragmentSlot>` (refactor plan §3.3, adapted from Piral's extension-slot
 * API — §5 maturity matrix). Published from `@mvp/runtime/react` (not the
 * package root) so the Node-safe core in `./index.ts` never pulls React into
 * non-React consumers (fastify fragment services, lifecycle scripts).
 *
 * Two lookup modes:
 * - `{ name, execution, fallback }` — look up a slot by name in a full
 *   `executeFragmentSlots`/`fetchFragmentSlots` result (either the
 *   `FragmentSlotsExecution` envelope or the bare `slots` record it wraps).
 * - `{ response, fallback }` — render an already-resolved
 *   `FragmentRenderResponse` (or `null`/`undefined`) directly.
 *
 * Rendering is byte-for-byte equivalent to the hand-written
 * `<FragmentHtml html fallback>` pattern every composed page used before
 * codegen: HTML present -> `dangerouslySetInnerHTML`; otherwise -> fallback.
 */
export type FragmentSlotProps =
  | {
      name: string;
      execution: FragmentSlotsExecution | Record<string, FragmentSlotResult>;
      fallback: ReactNode;
    }
  | {
      response: FragmentRenderResponse | null | undefined;
      fallback: ReactNode;
    };

export function FragmentSlot(props: FragmentSlotProps): ReactNode {
  const html =
    "response" in props
      ? props.response?.html
      : resolveSlotHtml(props.execution, props.name);
  if (!html) return props.fallback;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: fragment HTML is returned by trusted internal SSR fragment services.
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function resolveSlotHtml(
  execution: FragmentSlotsExecution | Record<string, FragmentSlotResult>,
  name: string,
): string | undefined {
  const slots = isFragmentSlotsExecution(execution)
    ? execution.slots
    : execution;
  return slots[name]?.response.html;
}

/**
 * A user-defined type guard (rather than a plain `"slots" in execution`
 * check) so TypeScript narrows both branches cleanly: `Record<string,
 * FragmentSlotResult>` has a string index signature, so a structural `in`
 * check can't tell "this is the `.slots` envelope" apart from "this is a
 * bare record that happens to have a `slots` key" without an explicit guard.
 */
function isFragmentSlotsExecution(
  value: FragmentSlotsExecution | Record<string, FragmentSlotResult>,
): value is FragmentSlotsExecution {
  return "health" in value && "data" in value && "slots" in value;
}
