"use client";

/**
 * Realtime data wiring for the trade terminal's patch-only panels.
 *
 * The three vanilla (non-React) panels — order-book, trades-feed,
 * positions-table — are server-rendered once, then kept live in the browser by
 * this layer: one shared `createTradeDataClient` subscribes each panel to its
 * source, and every frame is folded through the panel's **pure** patch function
 * (imported from each fragment's `patch` entry) into declarative instructions
 * that a tiny DOM shim applies in place. No React, no re-render, no innerHTML —
 * formatting mirrors SSR exactly so a patched cell is byte-identical to how the
 * server rendered it (no visual jump).
 *
 * The data client auto-attaches the deterministic mock transport for the
 * transport-backed feeds (book/trades), so in the browser frames simply tick on
 * a timer; `positions` has no mock generator and rides the core poll loop.
 * Everything is injectable (`transportScheduler`) so tests advance frames by
 * hand and assert the resulting DOM mutation.
 *
 * Symbol switches (published on the shared store's `TRADE_ACTIVE_SYMBOL` slice,
 * e.g. from the market-header) tear down the per-symbol subscriptions and
 * re-subscribe for the new symbol; the full layer teardown cancels everything.
 */

import type {
  DataSubscriptionEvent,
  MockScheduler,
  OrderbookL2Frame,
} from "@mvp/data";
import { createTradeDataClient, type TradeDataClient } from "@mvp/data";
import {
  buildLadder,
  diffLadder,
  formatPrice,
  formatSize,
  type Ladder,
  type LadderPatchSet,
  type LadderRow,
} from "@mvp/fragment-order-book/patch";
import {
  applyPositionsFrame,
  createPositionsState,
  type PositionRow,
  type PositionsPatchSet,
  type PositionsState,
} from "@mvp/fragment-positions-table/patch";
import {
  createTapeState,
  prependPrint,
  type TapePatch,
  type TapePrint,
  type TapeState,
} from "@mvp/fragment-trades-feed/patch";
import { TRADE_ACTIVE_SYMBOL, type TradeSlices } from "@mvp/interaction";
import { createRequestContext } from "@mvp/request-context";
import type { TradeStore } from "@mvp/trade-client";

/** Options for {@link startTradeRealtime} — all optional; tests inject a scheduler. */
export type TradeRealtimeOptions = {
  /** Deterministic seed for the auto-attached mock transports. */
  transportSeed?: number;
  /** Injectable scheduler so tests advance frames without real timers. */
  transportScheduler?: MockScheduler;
  /**
   * Explicit client factory (tests may pass a pre-built client). Defaults to
   * `createTradeDataClient` with a minimal client-side request context.
   */
  createClient?: (symbols: string[]) => TradeDataClient;
};

/** Per-panel node selectors (the SSR fragment roots). */
const PANEL_SELECTOR = {
  book: '[data-fragment="order-book"]',
  trades: '[data-fragment="trades-feed"]',
  positions: '[data-fragment="positions-table"]',
} as const;

/** Reads the active symbol from the page root, falling back to the store slice. */
export function resolveActiveSymbol(
  root: ParentNode,
  store: TradeStore<TradeSlices>,
): string {
  const pageEl =
    (root as Element).closest?.('[data-page="trade"][data-symbol]') ??
    root.querySelector?.('[data-page="trade"][data-symbol]') ??
    null;
  const fromDom = pageEl?.getAttribute?.("data-symbol");
  if (fromDom && fromDom.trim() !== "") return fromDom.trim().toUpperCase();
  return store.get(TRADE_ACTIVE_SYMBOL).symbol.trim().toUpperCase();
}

/**
 * A per-panel live controller: owns its subscription + patch state and applies
 * incoming frames to its DOM node. `stop()` cancels the subscription.
 */
type PanelController = { stop: () => void };

// ---------------------------------------------------------------------------
// Order book
// ---------------------------------------------------------------------------

/** Depth read from the rendered ladder (rows per side); default matches SSR. */
function bookDepth(node: Element): number {
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
      `[data-side="${cell.side}"] [data-price="${cssEscape(cell.key)}"]`,
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
  const doc = getDocument();
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

function wireOrderBook(
  node: Element,
  client: TradeDataClient,
  symbol: string,
  options: { rebuild?: boolean } = {},
): PanelController {
  const depth = bookDepth(node);
  // On a symbol switch the SSR rows hold the previous symbol's prices, so start
  // from an empty ladder and full-render the first frame; on the initial wire,
  // seed from the rendered rows so the first live frame only patches deltas.
  let prev: Ladder | null = options.rebuild
    ? null
    : ladderFromDom(node, symbol, depth);
  const stop = client.subscribe<OrderbookL2Frame>(
    client.sourceIds.bookL2(symbol),
    (event: DataSubscriptionEvent<OrderbookL2Frame>) => {
      const frame = event.data;
      if (!frame || !Array.isArray(frame.bids)) return;
      const next = buildLadder(frame, depth);
      if (prev === null) {
        renderLadder(node, next);
      } else {
        applyLadderPatch(node, diffLadder(prev, next));
      }
      prev = next;
    },
  );
  return { stop };
}

/** Rebuilds a ladder from the SSR rows so the first live diff is minimal. */
function ladderFromDom(node: Element, symbol: string, depth: number): Ladder {
  const read = (side: "bid" | "ask") => {
    const rows = [
      ...node.querySelectorAll(`[data-side="${side}"] [data-price]`),
    ];
    return rows.map((row) => {
      const price = Number(
        row.querySelector('[data-field="price"]')?.getAttribute("data-value") ??
          "0",
      );
      const size = parseNum(fieldText(row, "size"));
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

// ---------------------------------------------------------------------------
// Trades feed
// ---------------------------------------------------------------------------

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
  const doc = getDocument();
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

function wireTradesFeed(
  node: Element,
  client: TradeDataClient,
  symbol: string,
): PanelController {
  let state: TapeState = tapeStateFromDom(node, symbol);
  // The SSR snapshot and the client mock transport are independent sequence
  // origins (SSR fixtures rendered up to seq N; the browser transport restarts
  // at seq 1). `prependPrint` rejects any print with `seq < head.seq` as stale,
  // so raw live prints would be dropped. Rebase each incoming print onto a
  // monotonic seq above the SSR baseline so live frames always prepend.
  let nextSeq = state.prints[0]?.seq ?? 0;
  const stop = client.subscribe<TapePrint | TapePrint[]>(
    client.sourceIds.trades(symbol),
    (event) => {
      const data = event.data;
      if (!data) return;
      const prints = Array.isArray(data) ? data : [data];
      for (const print of prints) {
        nextSeq += 1;
        const result = prependPrint(state, { ...print, seq: nextSeq });
        state = result.state;
        applyTapePatch(node, result.patch);
      }
    },
  );
  return { stop };
}

/** Seeds tape state from the SSR rows so seq de-dup / trim stay correct. */
function tapeStateFromDom(node: Element, symbol: string): TapeState {
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

// ---------------------------------------------------------------------------
// Positions table
// ---------------------------------------------------------------------------

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
        .querySelector(`[data-symbol="${cssEscape(rowPatch.key)}"]`)
        ?.remove();
      continue;
    }
    let row = body.querySelector(`[data-symbol="${cssEscape(rowPatch.key)}"]`);
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
  const doc = getDocument();
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

function wirePositions(
  node: Element,
  client: TradeDataClient,
): PanelController {
  let state: PositionsState = positionsStateFromDom(node);
  const stop = client.subscribe<PositionRow | PositionRow[]>(
    client.sourceIds.positions,
    (event) => {
      const data = event.data;
      if (!data) return;
      const frame = Array.isArray(data) ? data : [data];
      const result = applyPositionsFrame(state, frame);
      state = result.state;
      applyPositionsPatch(node, result.patch);
    },
  );
  return { stop };
}

/** Seeds positions state from the SSR rows (keys only; values re-patch live). */
function positionsStateFromDom(node: Element): PositionsState {
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

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Starts the realtime layer: wires every present patch-only panel under `root`
 * to the shared data client for the current symbol, and re-subscribes when the
 * shared store's active symbol changes. Returns a teardown that cancels all
 * subscriptions and the store listener.
 */
export function startTradeRealtime(
  root: ParentNode,
  store: TradeStore<TradeSlices>,
  options: TradeRealtimeOptions = {},
): () => void {
  const makeClient =
    options.createClient ??
    ((symbols: string[]) =>
      createTradeDataClient({
        ctx: createRequestContext({}),
        symbols,
        transportSeed: options.transportSeed,
        transportScheduler: options.transportScheduler,
      }));

  let controllers: PanelController[] = [];
  let client: TradeDataClient | null = null;

  const wireForSymbol = (symbol: string, rebuild = false) => {
    client = makeClient([symbol]);
    controllers = [];
    const bookNode = root.querySelector?.(PANEL_SELECTOR.book);
    if (bookNode && !bookNode.hasAttribute("data-fallback")) {
      controllers.push(wireOrderBook(bookNode, client, symbol, { rebuild }));
    }
    const tradesNode = root.querySelector?.(PANEL_SELECTOR.trades);
    if (tradesNode && !tradesNode.hasAttribute("data-fallback")) {
      // The tape shows no per-row symbol, so on a switch clear the previous
      // symbol's prints and let the new symbol's frames repopulate it.
      if (rebuild)
        tradesNode.querySelector("[data-trades-body]")?.replaceChildren();
      controllers.push(wireTradesFeed(tradesNode, client, symbol));
    }
    const positionsNode = root.querySelector?.(PANEL_SELECTOR.positions);
    if (positionsNode && !positionsNode.hasAttribute("data-fallback")) {
      controllers.push(wirePositions(positionsNode, client));
    }
  };

  const unwire = () => {
    for (const controller of controllers) controller.stop();
    controllers = [];
    client = null;
  };

  let current = resolveActiveSymbol(root, store);
  wireForSymbol(current);

  // Re-subscribe on active-symbol change (positions stay live across symbols,
  // but re-wiring keeps a single client per symbol set — spine §4.1).
  const unsubscribeStore = store.subscribe(TRADE_ACTIVE_SYMBOL, (payload) => {
    const next = (payload as { symbol?: string }).symbol?.trim().toUpperCase();
    if (!next || next === current) return;
    current = next;
    unwire();
    wireForSymbol(current, true);
  });

  return () => {
    unsubscribeStore();
    unwire();
  };
}

// ---------------------------------------------------------------------------
// Tiny DOM helpers (the only DOM-touching code; kept trivially small)
// ---------------------------------------------------------------------------

function getDocument(): Document {
  return (globalThis as { document: Document }).document;
}

function setFieldText(scope: Element, field: string, text: string): void {
  const el = scope.querySelector(`[data-field="${field}"]`);
  if (el && el.textContent !== text) el.textContent = text;
}

function fieldText(scope: Element, field: string): string {
  return scope.querySelector(`[data-field="${field}"]`)?.textContent ?? "";
}

/** Parses a locale-formatted number string (thousands separators) back to a number. */
function parseNum(text: string): number {
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Escapes a value for safe use inside an attribute-equals CSS selector. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
