/**
 * Browser-side live panel for the positions table.
 *
 * Subscribes to the global `positions` source declared in
 * `positionsTableManifest.subscriptions` and folds each frame through the pure
 * `patch` module into row upserts / removals.
 *
 * Note the subscription binds NO parameter. That is what keeps the rendered
 * rows across a symbol switch: the live driver only marks a panel `remounted`
 * when a parameter the panel itself binds changed, and positions are global to
 * the account, not scoped to the symbol on screen.
 */

import {
  cssEscapeAttr,
  type LivePanel,
  type LivePanelHandle,
  type LivePanelMountContext,
  panelDocument,
  setFieldText,
} from "@mvp/runtime/live";
import { positionsTableManifest } from "./manifest";
import {
  applyPositionsFrame,
  createPositionsState,
  type PositionRow,
  type PositionsPatchSet,
  type PositionsState,
} from "./patch";

/** Applies a positions patch set (row upsert / remove) to the table body. */
export function applyPositionsPatch(
  node: Element,
  patch: PositionsPatchSet,
): void {
  const body = node.querySelector("[data-positions-body]");
  if (!body) return;
  for (const rowPatch of patch.patches) {
    if (rowPatch.type === "remove") {
      body
        .querySelector(`[data-symbol="${cssEscapeAttr(rowPatch.key)}"]`)
        ?.remove();
      continue;
    }
    let row = body.querySelector(
      `[data-symbol="${cssEscapeAttr(rowPatch.key)}"]`,
    );
    if (!row) {
      body.querySelector(".pt-empty")?.remove();
      row = buildPositionRow(rowPatch.key);
      body.appendChild(row);
    }
    row.className = `pt-row pt-row--${rowPatch.direction}`;
    row.setAttribute("data-direction", rowPatch.direction);
    setFieldText(row, "symbol", rowPatch.key);
    setFieldText(
      row,
      "direction",
      rowPatch.direction === "short" ? "SHORT" : "LONG",
    );
    const dirCell = row.querySelector('[data-field="direction"]');
    if (dirCell)
      dirCell.className = `pt-cell pt-cell--side pt-side--${rowPatch.direction}`;
    setFieldText(row, "size", rowPatch.cells.size);
    setFieldText(row, "entry", rowPatch.cells.entry);
    setFieldText(row, "mark", rowPatch.cells.mark);
    setFieldText(row, "liq", rowPatch.cells.liq);
    setFieldText(row, "pnl", rowPatch.cells.pnl);
    const pnlCell = row.querySelector('[data-field="pnl"]');
    if (pnlCell) {
      pnlCell.className = `pt-cell pt-cell--num pt-pnl pt-pnl--${rowPatch.cells.pnlSign}`;
      pnlCell.setAttribute("data-sign", rowPatch.cells.pnlSign);
    }
  }
}

/** Builds an empty positions row skeleton for a newly opened symbol. */
function buildPositionRow(key: string): HTMLTableRowElement {
  const doc = panelDocument();
  const tr = doc.createElement("tr");
  tr.setAttribute("data-symbol", key);
  tr.setAttribute("role", "row");
  const cell = (field: string, cls: string) => {
    const td = doc.createElement("td");
    td.className = cls;
    td.setAttribute("data-field", field);
    return td;
  };
  tr.append(
    cell("symbol", "pt-cell pt-cell--symbol"),
    cell("direction", "pt-cell pt-cell--side"),
    cell("size", "pt-cell pt-cell--num"),
    cell("entry", "pt-cell pt-cell--num"),
    cell("mark", "pt-cell pt-cell--num"),
    cell("liq", "pt-cell pt-cell--num"),
    cell("pnl", "pt-cell pt-cell--num pt-pnl"),
  );
  const action = doc.createElement("td");
  action.className = "pt-cell pt-cell--action";
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "pt-close";
  btn.setAttribute("data-action", "close");
  btn.setAttribute("data-symbol", key);
  btn.textContent = "Close";
  action.appendChild(btn);
  tr.appendChild(action);
  return tr;
}

/** Seeds positions state from the SSR rows (keys only; values re-patch live). */
export function positionsStateFromDom(node: Element): PositionsState {
  const rows = [
    ...node.querySelectorAll("[data-positions-body] [data-symbol]"),
  ];
  const positions: PositionRow[] = rows.map((row) => ({
    symbol: row.getAttribute("data-symbol") ?? "",
    size: 0,
    entryPrice: 0,
    markPrice: 0,
    liquidationPrice: 0,
    unrealizedPnl: 0,
  }));
  return createPositionsState({ positions });
}

function mount(ctx: LivePanelMountContext): LivePanelHandle {
  let state: PositionsState = positionsStateFromDom(ctx.node);
  return {
    onFrame(_source, data) {
      if (!data) return;
      const frame = (Array.isArray(data) ? data : [data]) as PositionRow[];
      const result = applyPositionsFrame(state, frame);
      state = result.state;
      applyPositionsPatch(ctx.node, result.patch);
    },
  };
}

/** The positions table's live panel, wired from its own manifest declaration. */
export const positionsTableLivePanel: LivePanel = {
  fragment: positionsTableManifest.name,
  subscriptions: positionsTableManifest.subscriptions,
  mount,
};
