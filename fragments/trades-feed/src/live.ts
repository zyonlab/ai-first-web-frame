/**
 * Browser-side live panel for the trades tape.
 *
 * Subscribes to the source declared in `tradesFeedManifest.subscriptions` and
 * folds each print through the pure `tape` module into a prepend/trim patch.
 * Ships with the fragment, so the trade page contains no tape-specific code.
 */

import {
  type LivePanel,
  type LivePanelHandle,
  type LivePanelMountContext,
  panelDocument,
} from "@mvp/runtime/live";
import { tradesFeedManifest } from "./manifest";
import {
  createTapeState,
  prependPrint,
  type TapePatch,
  type TapePrint,
  type TapeState,
} from "./patch";

/** Applies a tape patch (prepend + trim) to the trades-feed DOM body. */
export function applyTapePatch(node: Element, patch: TapePatch): void {
  const body = node.querySelector("[data-trades-body]");
  if (!body) return;
  if (patch.type === "prepend") {
    for (const seq of patch.trimmedSeqs) {
      body.querySelector(`[data-seq="${seq}"]`)?.remove();
    }
    const row = renderTapeRow(patch);
    body.insertBefore(row, body.firstChild);
  } else if (patch.type === "clear") {
    body.replaceChildren();
  }
}

/** Builds a tape row DOM node matching the SSR markup exactly (no innerHTML). */
function renderTapeRow(
  patch: Extract<TapePatch, { type: "prepend" }>,
): HTMLTableRowElement {
  const doc = panelDocument();
  const tr = doc.createElement("tr");
  tr.className = `trades-tape__row trades-tape__row--${patch.side}`;
  tr.setAttribute("data-seq", String(patch.seq));
  tr.setAttribute("data-side", patch.side);
  const time = doc.createElement("td");
  time.className = "trades-tape__cell trades-tape__cell--time";
  time.textContent = patch.cells.time;
  const price = doc.createElement("td");
  price.className = "trades-tape__cell trades-tape__cell--price";
  price.setAttribute("data-side", patch.side);
  price.textContent = patch.cells.price;
  const size = doc.createElement("td");
  size.className = "trades-tape__cell trades-tape__cell--size";
  size.textContent = patch.cells.size;
  tr.append(time, price, size);
  return tr;
}

/** Seeds tape state from the SSR rows so seq de-dup / trim stay correct. */
export function tapeStateFromDom(node: Element, symbol: string): TapeState {
  const limit = Number(node.getAttribute("data-limit")) || 30;
  const rows = [...node.querySelectorAll("[data-trades-body] [data-seq]")];
  const prints: TapePrint[] = rows.map((row) => ({
    seq: Number(row.getAttribute("data-seq")),
    ts: 0,
    side: (row.getAttribute("data-side") as TapePrint["side"]) ?? "buy",
    price: 0,
    size: 0,
    symbol,
  }));
  return createTapeState({ symbol, limit, prints });
}

function mount(ctx: LivePanelMountContext): LivePanelHandle {
  const { node, params, remounted } = ctx;
  const symbol = params.symbol ?? "";

  // The tape shows no per-row symbol, so on a symbol switch the rendered prints
  // are indistinguishable from the new symbol's — clear them and let the new
  // subscription repopulate rather than interleaving two symbols' trades.
  if (remounted) node.querySelector("[data-trades-body]")?.replaceChildren();

  let state: TapeState = tapeStateFromDom(node, symbol);
  // The SSR snapshot and the client mock transport are independent sequence
  // origins (SSR fixtures rendered up to seq N; the browser transport restarts
  // at seq 1). `prependPrint` rejects any print with `seq < head.seq` as stale,
  // so raw live prints would be dropped. Rebase each incoming print onto a
  // monotonic seq above the SSR baseline so live frames always prepend.
  let nextSeq = state.prints[0]?.seq ?? 0;

  return {
    onFrame(_source, data) {
      if (!data) return;
      const prints = (Array.isArray(data) ? data : [data]) as TapePrint[];
      for (const print of prints) {
        nextSeq += 1;
        const result = prependPrint(state, { ...print, seq: nextSeq });
        state = result.state;
        applyTapePatch(node, result.patch);
      }
    },
  };
}

/** The trades tape's live panel, wired from its own manifest declaration. */
export const tradesFeedLivePanel: LivePanel = {
  fragment: tradesFeedManifest.name,
  subscriptions: tradesFeedManifest.subscriptions,
  mount,
};
