/**
 * Browser-side live panel for the order book.
 *
 * This is the half of the fragment that runs after SSR: it subscribes to the
 * source declared in `orderBookManifest.subscriptions` and folds each L2 frame
 * into an in-place DOM patch through the pure `ladder` module. It ships with
 * the fragment rather than with the page, so making the book live — or changing
 * what it subscribes to — never touches the trade page.
 *
 * No React and no bundler-visible React import: the ladder is the hottest panel
 * on the page and re-rendering it through a component tree is exactly what the
 * JS budget forbids.
 */

import {
  cssEscapeAttr,
  fieldText,
  type LivePanel,
  type LivePanelHandle,
  type LivePanelMountContext,
  panelDocument,
  parseFieldNumber,
  setFieldText,
} from "@mvp/runtime/live";
import type { OrderbookL2Frame } from "@mvp/trade-data";
import {
  buildLadder,
  diffLadder,
  formatPrice,
  formatSize,
  type Ladder,
  type LadderPatchSet,
  type LadderRow,
} from "./ladder";
import { orderBookManifest } from "./manifest";

/** Depth read from the rendered ladder (rows per side); default matches SSR. */
export function bookDepth(node: Element): number {
  const bids = node.querySelectorAll('[data-side="bid"] [data-price]').length;
  return bids > 0 ? bids : 12;
}

/**
 * Applies a ladder patch set to the order-book DOM: updates each level's size /
 * total cells (and the spread strip) exactly where they changed. Rows are keyed
 * by `data-price`; a level not yet in the DOM (newly appeared) is skipped rather
 * than inserted — the ladder keeps a stable set of price rows, so in practice
 * only size/total/spread text moves.
 */
export function applyLadderPatch(node: Element, patch: LadderPatchSet): void {
  for (const cell of patch.patches) {
    const row = node.querySelector(
      `[data-side="${cell.side}"] [data-price="${cssEscapeAttr(cell.key)}"]`,
    );
    if (!row) continue;
    if (cell.size !== undefined) setFieldText(row, "size", cell.size);
    if (cell.total !== undefined) setFieldText(row, "total", cell.total);
    if (cell.depth !== undefined) {
      (row as HTMLElement).style.setProperty(
        "--depth",
        `${(cell.depth * 100).toFixed(2)}%`,
      );
    }
  }
  setFieldText(node, "spread", patch.spread);
  setFieldText(node, "mid", patch.mid);
  setFieldText(node, "spread-pct", `(${patch.spreadPct})`);
}

/** Builds one ladder `<tr>` matching the SSR markup exactly (no innerHTML). */
function buildLadderRow(row: LadderRow): HTMLTableRowElement {
  const doc = panelDocument();
  const tr = doc.createElement("tr");
  tr.className = `ob-row ob-${row.side}`;
  tr.setAttribute("role", "row");
  tr.setAttribute("tabindex", "0");
  tr.setAttribute("data-price", row.key);
  tr.setAttribute("data-side", row.side);
  tr.style.setProperty("--depth", `${(row.depth * 100).toFixed(2)}%`);
  const price = doc.createElement("td");
  price.className = "ob-price";
  price.setAttribute("data-field", "price");
  price.setAttribute("data-value", String(row.price));
  price.textContent = formatPrice(row.price);
  const size = doc.createElement("td");
  size.className = "ob-num";
  size.setAttribute("data-field", "size");
  size.textContent = formatSize(row.size);
  const total = doc.createElement("td");
  total.className = "ob-num";
  total.setAttribute("data-field", "total");
  total.textContent = formatSize(row.total);
  tr.append(price, size, total);
  return tr;
}

/**
 * Rebuilds the whole price ladder in place. Unlike {@link applyLadderPatch}
 * (which only moves size/total on stable price rows), this replaces every row —
 * needed on a symbol switch, where the entire price range changes and the SSR
 * rows carry the previous symbol's keys. Asks render worst→best top-down.
 */
export function renderLadder(node: Element, ladder: Ladder): void {
  const asksBody = node.querySelector(".ob-asks");
  if (asksBody)
    asksBody.replaceChildren(...[...ladder.asks].reverse().map(buildLadderRow));
  const bidsBody = node.querySelector(".ob-bids");
  if (bidsBody) bidsBody.replaceChildren(...ladder.bids.map(buildLadderRow));
  setFieldText(node, "spread", formatPrice(ladder.spread));
  setFieldText(node, "mid", formatPrice(ladder.mid));
  setFieldText(node, "spread-pct", `(${ladder.spreadPct.toFixed(3)}%)`);
}

/** Rebuilds a ladder from the SSR rows so the first live diff is minimal. */
export function ladderFromDom(
  node: Element,
  symbol: string,
  depth: number,
): Ladder {
  const read = (side: "bid" | "ask") => {
    const rows = [
      ...node.querySelectorAll(`[data-side="${side}"] [data-price]`),
    ];
    return rows.map((row) => {
      const price = Number(
        row.querySelector('[data-field="price"]')?.getAttribute("data-value") ??
          "0",
      );
      const size = parseFieldNumber(fieldText(row, "size"));
      return { price, size };
    });
  };
  const frame: OrderbookL2Frame = {
    channel: "orderbook.l2",
    symbol,
    seq: 0,
    ts: 0,
    bids: read("bid"),
    // Asks render worst→best top-down in the DOM; reverse to best-first.
    asks: read("ask").reverse(),
    spread: 0,
  };
  return buildLadder(frame, depth);
}

function mount(ctx: LivePanelMountContext): LivePanelHandle {
  const { node, params, remounted } = ctx;
  const symbol = params.symbol ?? "";
  const depth = bookDepth(node);
  // On a symbol switch the SSR rows hold the previous symbol's prices, so start
  // from an empty ladder and full-render the first frame; on the initial mount,
  // seed from the rendered rows so the first live frame only patches deltas.
  let prev: Ladder | null = remounted
    ? null
    : ladderFromDom(node, symbol, depth);

  return {
    onFrame(_source, data) {
      const frame = data as OrderbookL2Frame | undefined;
      if (!frame || !Array.isArray(frame.bids)) return;
      const next = buildLadder(frame, depth);
      if (prev === null) {
        renderLadder(node, next);
      } else {
        applyLadderPatch(node, diffLadder(prev, next));
      }
      prev = next;
    },
  };
}

/** The order book's live panel, wired from its own manifest declaration. */
export const orderBookLivePanel: LivePanel = {
  fragment: orderBookManifest.name,
  subscriptions: orderBookManifest.subscriptions,
  mount,
};
