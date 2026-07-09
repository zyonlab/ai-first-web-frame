/**
 * Mount-time layout advisories (docs/AI_NATIVE_DEVX.md §2/§6). `mount-slot` can't
 * render the page, so it can't *measure* the pane — but it can read the
 * fragment's `layoutHint` and tell the author/agent what the target pane must
 * provide. This is the cheap counterpart to the runtime `layout-fit` check: it
 * catches the "put a fills/tall fragment in an auto row" mistake (the 490px
 * header-void class) at the moment the slot is wired, not after deploy.
 *
 * Pure (hint in → advisory strings out) so it is unit-tested; `mount-slot`
 * pushes the result onto its `warnings`.
 */

import type { LayoutHint } from "./unit-graph";

export type LayoutAdvisoryContext = { fragment: string; slot: string };

export function layoutAdvisories(
  hint: LayoutHint | undefined,
  ctx: LayoutAdvisoryContext,
): string[] {
  const out: string[] = [];
  if (!hint || Object.keys(hint).length === 0) {
    out.push(
      `layout: "${ctx.fragment}" declares no layoutHint — the page can't reason about its size/shape. Add { shape, minHeight?, fills? } to its manifest.`,
    );
    return out;
  }
  const shape = hint.shape ? ` (shape=${hint.shape})` : "";
  if (hint.fills) {
    out.push(
      `layout: "${ctx.fragment}"${shape} fills its pane — mount slot "${ctx.slot}" in a grid/flex cell that STRETCHES; an auto / max-content row strands its content above a void.`,
    );
  }
  if (typeof hint.minHeight === "number") {
    out.push(
      `layout: "${ctx.fragment}" needs minHeight ≥ ${hint.minHeight}px — ensure slot "${ctx.slot}" reserves at least that height.`,
    );
  }
  if (typeof hint.aspect === "number") {
    out.push(
      `layout: "${ctx.fragment}" prefers aspect ${hint.aspect} — size slot "${ctx.slot}" accordingly.`,
    );
  }
  out.push("layout: confirm the rendered fit with `pnpm verify:runtime`.");
  return out;
}
