/**
 * Patch-only vanilla client logic for the trades tape (NO React).
 *
 * Everything here is a pure, deterministic function so it can be unit-tested
 * without a DOM: given the current tape state + a new trade frame it computes
 * (a) the next capped-and-ordered state and (b) a declarative DOM patch
 * instruction the thin browser shim applies. The browser shim
 * ({@link applyTradesPatch}) is the only DOM-touching code and is intentionally
 * tiny — it just executes the instructions this module produces.
 *
 * This is the reference template for a patch-only realtime fragment: the SSR
 * HTML is the source of truth for first paint; the island prepends new prints
 * keyed by stream `seq`, trims to the tape ceiling, and — on a
 * `TRADE_ACTIVE_SYMBOL` switch — clears the tape and resubscribes.
 */

import { TRADE_ACTIVE_SYMBOL } from "@mvp/interaction";

/** Aggressor side of a print. */
export type TradeSide = "buy" | "sell";

/** The minimal print shape the tape renders/patches (a `TradePrintFrame` subset). */
export type TapePrint = {
  seq: number;
  ts: number;
  side: TradeSide;
  price: number;
  size: number;
  symbol: string;
};

/** Default number of prints kept in the tape (also the SSR render limit). */
export const DEFAULT_TRADES_LIMIT = 30;

/** Hard ceiling on the tape length, protecting memory + DOM node count. */
export const MAX_TRADES_LIMIT = 100;

/** Re-export the channel the island resubscribes on, so consumers stay in lockstep. */
export { TRADE_ACTIVE_SYMBOL };

// ---------------------------------------------------------------------------
// Formatting (shared by SSR render + client patch so a patched row is
// byte-identical to how SSR would have rendered it)
// ---------------------------------------------------------------------------

/** Formatted cells for a single print row (time / price / size), all strings. */
export type TapeRowCells = {
  time: string;
  price: string;
  size: string;
};

/**
 * Formats a print's logical `ts` (ms, derived from the tick index — NOT wall
 * clock) as a stable `HH:MM:SS` string in UTC. Deterministic: the same frame
 * always formats identically on server and client.
 */
export function formatTradeTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Formats price with thousands separators + 2 decimals (mono, right-aligned). */
export function formatTradePrice(price: number): string {
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Formats size with 4 decimals (mono, right-aligned). */
export function formatTradeSize(size: number): string {
  return size.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

/** Formats all three cells of a print for a tape row. */
export function formatPrintRow(print: {
  ts: number;
  price: number;
  size: number;
}): TapeRowCells {
  return {
    time: formatTradeTime(print.ts),
    price: formatTradePrice(print.price),
    size: formatTradeSize(print.size),
  };
}

// ---------------------------------------------------------------------------
// Pure tape reducer (prepend + cap)
// ---------------------------------------------------------------------------

/** In-memory tape state the island keeps between frames. */
export type TapeState = {
  symbol: string;
  limit: number;
  /** Newest-first prints, length <= limit. */
  prints: TapePrint[];
};

/** Normalizes a limit into the sane [1, MAX] range. */
export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_TRADES_LIMIT;
  const rounded = Math.floor(limit);
  if (rounded < 1) return 1;
  if (rounded > MAX_TRADES_LIMIT) return MAX_TRADES_LIMIT;
  return rounded;
}

/** Builds the initial tape state from the SSR snapshot (already newest-first). */
export function createTapeState(snapshot: {
  symbol: string;
  limit: number;
  prints: TapePrint[];
}): TapeState {
  const limit = clampLimit(snapshot.limit);
  return {
    symbol: snapshot.symbol,
    limit,
    prints: snapshot.prints.slice(0, limit),
  };
}

/** A declarative DOM patch instruction for the browser shim to apply. */
export type TapePatch =
  | {
      /** Prepend a new row (keyed by seq) and drop any trimmed seqs. */
      type: "prepend";
      seq: number;
      side: TradeSide;
      cells: TapeRowCells;
      /** Row seqs that must be removed because the tape overflowed. */
      trimmedSeqs: number[];
    }
  | {
      /** No visible change (stale/duplicate frame). */
      type: "noop";
      reason: "duplicate" | "stale";
    }
  | {
      /** Clear the whole tape body (symbol switch). */
      type: "clear";
      symbol: string;
    };

/**
 * Folds a new print into the tape: prepend at the head, then trim to `limit`.
 * A frame whose `seq` is already present, or is older than the current head, is
 * a no-op (the mock stream is monotonic, but the guard keeps patches
 * idempotent). Returns the next state plus the patch to apply to the DOM.
 */
export function prependPrint(
  state: TapeState,
  print: TapePrint,
): { state: TapeState; patch: TapePatch } {
  const head = state.prints[0];
  if (state.prints.some((p) => p.seq === print.seq)) {
    return { state, patch: { type: "noop", reason: "duplicate" } };
  }
  if (head && print.seq < head.seq) {
    return { state, patch: { type: "noop", reason: "stale" } };
  }

  const next = [print, ...state.prints];
  const trimmed = next.slice(0, state.limit);
  const trimmedSeqs = next.slice(state.limit).map((p) => p.seq);

  return {
    state: { ...state, prints: trimmed },
    patch: {
      type: "prepend",
      seq: print.seq,
      side: print.side,
      cells: formatPrintRow(print),
      trimmedSeqs,
    },
  };
}

/**
 * Clears the tape on a symbol switch. Returns a fresh, empty state for the new
 * symbol plus a `clear` patch. The island then resubscribes to
 * `trades.<newSymbol>` (see {@link resubscribeSymbol}).
 */
export function switchSymbol(
  state: TapeState,
  symbol: string,
): { state: TapeState; patch: TapePatch } {
  const nextSymbol = symbol.trim().toUpperCase();
  return {
    state: { ...state, symbol: nextSymbol, prints: [] },
    patch: { type: "clear", symbol: nextSymbol },
  };
}

// ---------------------------------------------------------------------------
// Subscription wiring (side-effecting, but injectable so it is testable)
// ---------------------------------------------------------------------------

/** The subset of the trade data client the tape island needs. */
export type TapeSubscribeClient = {
  subscribe: (
    id: string,
    handler: (event: { data: unknown }) => void,
  ) => () => void;
  sourceIds: { trades: (symbol: string) => string };
};

/** The subset of the interaction bus the tape island needs. */
export type TapeBus = {
  subscribe: (
    channel: string,
    handler: (payload: unknown) => void,
    options: { subscriber: string },
  ) => () => void;
};

/**
 * Subscribes to the `trades.<symbol>` feed, forwarding each frame to `onPrint`.
 * Returns the unsubscribe handle. Pure wiring: the caller owns state + DOM.
 */
export function resubscribeSymbol(
  client: TapeSubscribeClient,
  symbol: string,
  onPrint: (print: TapePrint) => void,
): () => void {
  return client.subscribe(client.sourceIds.trades(symbol), (event) => {
    const frame = event.data as TapePrint | TapePrint[] | undefined;
    if (!frame) return;
    // The realtime feed emits single prints; the SSR load emits an array. Guard
    // both so a snapshot-shaped payload does not crash the tape.
    if (Array.isArray(frame)) {
      for (const p of frame) onPrint(p);
    } else {
      onPrint(frame);
    }
  });
}

/**
 * The island's clear+resubscribe cycle on a `TRADE_ACTIVE_SYMBOL` change,
 * returned as an effect object the browser shim runs. Kept as pure data (no DOM
 * / no live subscription) so the symbol-switch flow is unit-testable: assert
 * the returned `patch` is a `clear` and `nextSymbol` matches the payload.
 */
export function onActiveSymbolChange(
  state: TapeState,
  payload: unknown,
): { state: TapeState; patch: TapePatch; nextSymbol: string } | undefined {
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { symbol?: unknown }).symbol !== "string"
  ) {
    return undefined;
  }
  const nextSymbol = (payload as { symbol: string }).symbol
    .trim()
    .toUpperCase();
  if (nextSymbol === state.symbol) return undefined;
  const result = switchSymbol(state, nextSymbol);
  return { state: result.state, patch: result.patch, nextSymbol };
}
