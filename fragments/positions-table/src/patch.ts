/**
 * Patch-only vanilla client logic for the positions table (NO React).
 *
 * Everything here is a pure, deterministic function so it can be unit-tested
 * without a DOM: given the current positions state + a new positions frame it
 * computes (a) the next state (keyed by symbol) and (b) a declarative DOM patch
 * set (row upserts + removals + per-cell text/sign changes) that a thin browser
 * shim applies. The browser shim is the only DOM-touching code and is
 * intentionally tiny — it just executes the instructions this module produces.
 *
 * This mirrors the batch1 patch-only fragments (`trades-feed`, `order-book`):
 * the SSR HTML is the source of truth for first paint; the island upserts /
 * removes rows keyed by `symbol`, recolors uPnL by sign, and — on a
 * `TRADE_ACTIVE_SYMBOL` switch — refocuses the active row (see
 * {@link onActiveSymbolChange}) and resubscribes to the `positions` feed.
 *
 * The realtime `positions` source is user-private with NO mock generator, so
 * the island resubscribes via the core poll loop (contract C4/C5); this module
 * stays transport-agnostic — it only transforms frames into patches.
 */

import { validateInteractionPayload } from "@mvp/interaction";
import { TRADE_ACTIVE_SYMBOL, tradeSliceContracts } from "@mvp/trade-contracts";

/** Long / short direction, derived from the (signed) position size. */
export type PositionDirection = "long" | "short";

/** The minimal position shape the table renders / patches (a `Position` subset). */
export type PositionRow = {
  symbol: string;
  size: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  unrealizedPnl: number;
};

/** Re-export the channel the island resubscribes on, so consumers stay in lockstep. */
export { TRADE_ACTIVE_SYMBOL };

/** The C3 active-symbol contract this island subscribes to (positions-table). */
const ACTIVE_SYMBOL_CONTRACT = tradeSliceContracts.find(
  (c) => c.channel === TRADE_ACTIVE_SYMBOL,
);

// ---------------------------------------------------------------------------
// Direction + formatting (shared by SSR render + client patch so a patched row
// is byte-identical to how SSR would have rendered it)
// ---------------------------------------------------------------------------

/** Direction from a signed size: positive = long, negative = short. */
export function directionOf(size: number): PositionDirection {
  return size < 0 ? "short" : "long";
}

/** Sign class for a uPnL value: "up" (>=0) or "down" (<0). Drives semantic color. */
export type PnlSign = "up" | "down";

/** Maps a uPnL number to its up/down sign (0 counts as up). */
export function pnlSign(value: number): PnlSign {
  return value < 0 ? "down" : "up";
}

/** Formats a price/level with thousands separators + 2 decimals (mono). */
export function formatPrice(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Formats a position size as its absolute magnitude with 4 decimals (mono). */
export function formatSize(size: number): string {
  return Math.abs(size).toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

/** Formats a uPnL with an explicit sign prefix + 2 decimals (mono). */
export function formatPnl(value: number): string {
  const sign = value < 0 ? "-" : "+";
  return `${sign}${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Formatted cells for a single position row, all strings (SSR === patch). */
export type PositionRowCells = {
  direction: PositionDirection;
  size: string;
  entry: string;
  mark: string;
  liq: string;
  pnl: string;
  pnlSign: PnlSign;
};

/** Formats every cell of a position row deterministically. */
export function formatPositionRow(position: PositionRow): PositionRowCells {
  return {
    direction: directionOf(position.size),
    size: formatSize(position.size),
    entry: formatPrice(position.entryPrice),
    mark: formatPrice(position.markPrice),
    liq: formatPrice(position.liquidationPrice),
    pnl: formatPnl(position.unrealizedPnl),
    pnlSign: pnlSign(position.unrealizedPnl),
  };
}

// ---------------------------------------------------------------------------
// Pure positions reducer (upsert + remove, keyed by symbol)
// ---------------------------------------------------------------------------

/** Normalizes a symbol to its canonical (uppercase, trimmed) key form. */
export function positionKey(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/** In-memory table state the island keeps between frames (ordered rows). */
export type PositionsState = {
  /** Currently active symbol (for row focus on switch); may be undefined. */
  activeSymbol?: string;
  /** Positions in stable render order, keyed by `positionKey(symbol)`. */
  positions: PositionRow[];
};

/** Builds the initial table state from the SSR snapshot. */
export function createPositionsState(snapshot: {
  activeSymbol?: string;
  positions: PositionRow[];
}): PositionsState {
  return {
    activeSymbol: snapshot.activeSymbol
      ? positionKey(snapshot.activeSymbol)
      : undefined,
    positions: [...snapshot.positions],
  };
}

/** A single declarative row instruction for the browser shim to apply. */
export type PositionsRowPatch =
  | {
      /** Insert a brand-new row (position opened). */
      type: "insert";
      key: string;
      direction: PositionDirection;
      cells: PositionRowCells;
    }
  | {
      /** Update an existing row's changed cells in place (keyed by symbol). */
      type: "update";
      key: string;
      direction: PositionDirection;
      cells: PositionRowCells;
    }
  | {
      /** Remove a row (position closed / gone from the frame). */
      type: "remove";
      key: string;
    };

/** Top-level patch set: ordered row instructions for a single frame. */
export type PositionsPatchSet = {
  patches: PositionsRowPatch[];
};

/**
 * Folds a fresh positions frame into the table: inserts newly opened symbols,
 * updates changed rows in place (keyed by symbol), and removes symbols no
 * longer present (closed). Deterministic: the same (prev, frame) pair always
 * yields the same ordered patch set, so patches are idempotent + testable with
 * no DOM. Returns the next state plus the patch set to apply.
 *
 * Order discipline: inserts/updates follow the new frame order; removals are
 * appended in the previous-state order. An "update" is only emitted when a
 * cell actually changed, so a no-change frame yields an empty patch set.
 */
export function applyPositionsFrame(
  state: PositionsState,
  frame: PositionRow[],
): { state: PositionsState; patch: PositionsPatchSet } {
  const prevByKey = new Map(
    state.positions.map((p) => [positionKey(p.symbol), p]),
  );
  const nextKeys = new Set<string>();
  const patches: PositionsRowPatch[] = [];
  const nextPositions: PositionRow[] = [];

  for (const position of frame) {
    const key = positionKey(position.symbol);
    nextKeys.add(key);
    nextPositions.push(position);
    const before = prevByKey.get(key);
    const cells = formatPositionRow(position);
    if (!before) {
      patches.push({ type: "insert", key, direction: cells.direction, cells });
      continue;
    }
    if (positionRowChanged(before, position)) {
      patches.push({ type: "update", key, direction: cells.direction, cells });
    }
  }

  for (const position of state.positions) {
    const key = positionKey(position.symbol);
    if (!nextKeys.has(key)) patches.push({ type: "remove", key });
  }

  return {
    state: { ...state, positions: nextPositions },
    patch: { patches },
  };
}

/** True when any rendered field of a position changed between frames. */
export function positionRowChanged(a: PositionRow, b: PositionRow): boolean {
  return (
    a.size !== b.size ||
    a.entryPrice !== b.entryPrice ||
    a.markPrice !== b.markPrice ||
    a.liquidationPrice !== b.liquidationPrice ||
    a.unrealizedPnl !== b.unrealizedPnl
  );
}

// ---------------------------------------------------------------------------
// Symbol switch (row focus) — C3 TRADE_ACTIVE_SYMBOL
// ---------------------------------------------------------------------------

/**
 * A declarative focus patch: highlight the row for the newly active symbol and
 * clear the previously active one. Unlike the tape/book (which clear on
 * switch), the positions table shows ALL symbols at once — a symbol switch only
 * moves the "active" highlight, it does not drop rows.
 */
export type PositionsFocusPatch = {
  type: "focus";
  /** Symbol row to mark active (may not exist in the table — shim tolerates). */
  activeKey: string;
  /** Symbol row to clear (previous active), if any. */
  previousKey?: string;
};

/**
 * Handles a `TRADE_ACTIVE_SYMBOL` change: validates the payload against the
 * frozen C3 schema, then returns the next state + a focus patch. Returns
 * `undefined` for a malformed payload or a no-op switch (same symbol). Pure
 * data (no DOM / no live subscription) so the flow is unit-testable.
 */
export function onActiveSymbolChange(
  state: PositionsState,
  payload: unknown,
): { state: PositionsState; patch: PositionsFocusPatch } | undefined {
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { symbol?: unknown }).symbol !== "string"
  ) {
    return undefined;
  }
  // Reject anything the frozen C3 active-symbol schema would reject.
  validateInteractionPayload(
    ACTIVE_SYMBOL_CONTRACT?.payloadSchema,
    payload,
    `${TRADE_ACTIVE_SYMBOL} subscribe`,
  );
  const activeKey = positionKey((payload as { symbol: string }).symbol);
  if (activeKey === state.activeSymbol) return undefined;
  return {
    state: { ...state, activeSymbol: activeKey },
    patch: {
      type: "focus",
      activeKey,
      ...(state.activeSymbol ? { previousKey: state.activeSymbol } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Subscription wiring (side-effecting, but injectable so it is testable)
// ---------------------------------------------------------------------------

/** The subset of the trade data client the positions island needs. */
export type PositionsSubscribeClient = {
  subscribe: (
    id: string,
    handler: (event: { data: unknown }) => void,
  ) => () => void;
  sourceIds: { positions: string };
};

/**
 * Subscribes to the global `positions` feed, forwarding each frame (an array of
 * positions) to `onFrame`. Returns the unsubscribe handle. Pure wiring: the
 * caller owns state + DOM. A single-position payload is tolerated by wrapping it
 * in an array so a poll snapshot and a delta frame are handled uniformly.
 */
export function subscribePositions(
  client: PositionsSubscribeClient,
  onFrame: (frame: PositionRow[]) => void,
): () => void {
  return client.subscribe(client.sourceIds.positions, (event) => {
    const data = event.data as PositionRow | PositionRow[] | undefined;
    if (!data) return;
    onFrame(Array.isArray(data) ? data : [data]);
  });
}
