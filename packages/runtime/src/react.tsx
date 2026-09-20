import type { FragmentRenderResponse } from "@mvp/contracts";
import type { ReactElement, ReactNode } from "react";
import {
  buildServerTiming,
  type FragmentSlotResult,
  type FragmentSlotsExecution,
  failedRequiredSlotNames,
  PAGE_HEALTH_ATTR,
  PAGE_HEALTH_FAILED_ATTR,
  PAGE_TIMING_ATTR,
} from "./index";

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
  return renderFragmentSlotHtml(html, props.fallback);
}

/**
 * Shared rendering core (refactor plan §4.4): HTML present ->
 * `dangerouslySetInnerHTML`; otherwise -> fallback. Used by both the
 * synchronous `<FragmentSlot>` above (an already-resolved
 * `execution`/`response`) and the async `<FragmentSlotStream>` below (which
 * awaits its own per-slot promise first) so the two produce byte-identical
 * markup regardless of which one a page uses.
 *
 * Generic over the fallback type so `<FragmentSlotStream>` — an async Server
 * Component — can pass a narrower `ReactElement` fallback and get back a
 * `ReactElement` result: `@types/react`'s JSX-element check for async
 * components only accepts resolved values assignable to `AwaitedReactNode`
 * (a strict subset of the full `ReactNode` union), so returning the wider
 * `ReactNode` from an async component fails to type-check even though it's
 * fine for the synchronous `<FragmentSlot>`.
 */
function renderFragmentSlotHtml<Fallback extends ReactNode>(
  html: string | undefined,
  fallback: Fallback,
): ReactElement | Fallback {
  if (!html) return fallback;
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

/**
 * `<FragmentSlotStream>` (refactor plan §4.4) — the Suspense-compatible
 * counterpart to `<FragmentSlot>`. Instead of an already-resolved
 * `execution`/`response`, it takes ONE slot's own promise — as returned
 * per-slot by `streamFragmentSlots` (`@mvp/runtime`) — and `await`s it
 * itself: since this is an async Server Component, wrapping it in
 * `<Suspense fallback={...}>` streams that slot's HTML into the response the
 * moment ITS OWN promise resolves, independent of sibling slots or of the
 * page's full diagnostics aggregate. Renders through the same
 * `renderFragmentSlotHtml` helper `<FragmentSlot>` uses, so the HTML/fallback
 * markup is byte-identical to the synchronous component.
 *
 * `fallback` is typed `ReactElement` (narrower than `<FragmentSlot>`'s
 * `ReactNode`) so this async component's inferred return type stays
 * assignable to `AwaitedReactNode` — see `renderFragmentSlotHtml`'s doc
 * comment. Every real fallback in this codebase is already a JSX element
 * (a `<section data-fragment=... data-fallback="true">` block), so this is
 * not a practical restriction.
 */
export type FragmentSlotStreamProps = {
  slotPromise: Promise<FragmentRenderResponse>;
  fallback: ReactElement;
};

// No explicit return-type annotation: letting TypeScript infer
// `Promise<ReactElement>` from `renderFragmentSlotHtml`'s generic result is
// what keeps this assignable to `AwaitedReactNode` for the JSX-element check;
// spelling out `Promise<ReactNode>` explicitly re-introduces the mismatch.
export async function FragmentSlotStream({
  slotPromise,
  fallback,
}: FragmentSlotStreamProps) {
  const response = await slotPromise;
  return renderFragmentSlotHtml(response?.html, fallback);
}

/**
 * `<PageHealthMeta>` — stamps the page's aggregate health into the markup so the
 * shell gateway can answer with an honest status code (see `PAGE_HEALTH_ATTR` in
 * `./index.ts` for why a hidden `div` rather than a `<meta>`: this is an internal
 * gateway signal, not document metadata, so it stays out of `<head>` even though
 * React 19 would hoist a `<meta>` there).
 *
 * Render it once per composed page. It is `hidden`, so it emits nothing visible,
 * contributes no layout, and adds no client JS.
 */
export type PageHealthMetaProps = {
  execution: FragmentSlotsExecution;
};

/**
 * `<PageTimingMeta>` — stamps per-slot `Server-Timing` into the markup so the
 * gateway can promote it to a real response header.
 *
 * Render it beside `<PageHealthMeta>`. Same mechanism, same reason: a page
 * component cannot set a header, and the gateway already reads the body.
 */
export function PageTimingMeta({ execution }: PageHealthMetaProps): ReactNode {
  return (
    <div
      hidden
      {...{ [PAGE_TIMING_ATTR]: buildServerTiming(execution.slots) }}
    />
  );
}

export function PageHealthMeta({ execution }: PageHealthMetaProps): ReactNode {
  const failed = failedRequiredSlotNames(execution);
  return (
    <div
      hidden
      {...{
        [PAGE_HEALTH_ATTR]: execution.health,
        [PAGE_HEALTH_FAILED_ATTR]: failed.join(","),
      }}
    />
  );
}

/**
 * Async counterpart for streaming pages, which only hold a promise of the
 * aggregate. Wrap in `<Suspense fallback={null}>`: a marker that arrives late
 * is still in the response body the gateway reads, and a page that never
 * resolves one is simply treated as not participating.
 */
/**
 * Streaming counterpart of {@link PageTimingMeta}. Per-slot durations are only
 * known once the aggregate settles, so this awaits it — which places the marker
 * late in the body. That is fine: the gateway buffers the body to translate the
 * status code anyway, so it sees the marker before it writes any header.
 */
export async function PageTimingMetaStream({
  execution,
}: {
  execution: Promise<FragmentSlotsExecution>;
}) {
  const resolved = await execution;
  return (
    <div
      hidden
      {...{ [PAGE_TIMING_ATTR]: buildServerTiming(resolved.slots) }}
    />
  );
}

export async function PageHealthMetaStream({
  execution,
}: {
  execution: Promise<FragmentSlotsExecution>;
}) {
  const resolved = await execution;
  const failed = failedRequiredSlotNames(resolved);
  return (
    <div
      hidden
      {...{
        [PAGE_HEALTH_ATTR]: resolved.health,
        [PAGE_HEALTH_FAILED_ATTR]: failed.join(","),
      }}
    />
  );
}
