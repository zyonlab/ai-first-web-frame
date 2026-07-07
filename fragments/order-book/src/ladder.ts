import type { BookLevel, OrderbookL2Frame } from "@mvp/data";

/**
 * Pure ladder math shared by the SSR renderer and the vanilla patch client.
 *
 * Nothing here imports React, the DOM, or any runtime — it is deterministic
 * `(frame) -> rows` + `(prev, next) -> patch instructions`. This is the
 * testable core of the patch-only island (P2 unit target): given a new frame
 * it computes exactly which per-price-level cells changed.
 */

export type BookSide = "bid" | "ask";

/** A rendered ladder row: one price level with cumulative total + depth ratio. */
export type LadderRow = {
  side: BookSide;
  /** Canonical price key (stable id for patching), e.g. "64120.5". */
  key: string;
  price: number;
  size: number;
  /** Cumulative size from the touch outward (running total). */
  total: number;
  /** Depth ratio in [0,1] = cumulative / max cumulative across both sides. */
  depth: number;
};

/** The full computed ladder + spread strip, ready to render or patch. */
export type Ladder = {
  symbol: string;
  seq: number;
  /** Asks worst→best top-to-bottom is a *view* concern; we keep best-first. */
  asks: LadderRow[];
  bids: LadderRow[];
  spread: number;
  mid: number;
  spreadPct: number;
};

/** Stable price key so patch instructions line up SSR rows with new frames. */
export function priceKey(price: number): string {
  // Fixed precision avoids float formatting drift between server and client.
  return price.toFixed(4).replace(/\.?0+$/, "");
}

function cumulate(levels: BookLevel[], side: BookSide): LadderRow[] {
  let running = 0;
  const rows: LadderRow[] = [];
  for (const level of levels) {
    running = round4(running + level.size);
    rows.push({
      side,
      key: priceKey(level.price),
      price: level.price,
      size: level.size,
      total: running,
      depth: 0,
    });
  }
  return rows;
}

/**
 * Builds the depth-annotated ladder from a raw L2 frame, limited to `depth`
 * levels per side. Depth bars are normalized against the max cumulative total
 * across both sides so bid/ask bars are comparable.
 */
export function buildLadder(
  frame: OrderbookL2Frame,
  depth = frame.bids.length,
): Ladder {
  const bids = cumulate(frame.bids.slice(0, depth), "bid");
  const asks = cumulate(frame.asks.slice(0, depth), "ask");
  const maxTotal = Math.max(
    1e-9,
    bids.at(-1)?.total ?? 0,
    asks.at(-1)?.total ?? 0,
  );
  for (const row of bids) row.depth = clamp01(row.total / maxTotal);
  for (const row of asks) row.depth = clamp01(row.total / maxTotal);

  const bestBid = frame.bids[0]?.price ?? 0;
  const bestAsk = frame.asks[0]?.price ?? 0;
  const mid = round2((bestBid + bestAsk) / 2);
  const spread = round2(frame.spread ?? bestAsk - bestBid);
  const spreadPct = mid > 0 ? round4((spread / mid) * 100) : 0;

  return {
    symbol: frame.symbol,
    seq: frame.seq,
    asks,
    bids,
    spread,
    mid,
    spreadPct,
  };
}

// --- Patch diffing ----------------------------------------------------------

/** A single per-cell patch instruction the client applies to the SSR DOM. */
export type LadderPatch = {
  side: BookSide;
  key: string;
  /** New formatted size text (undefined = unchanged). */
  size?: string;
  /** New formatted total text (undefined = unchanged). */
  total?: string;
  /** New depth ratio in [0,1] (undefined = unchanged). */
  depth?: number;
  /** True when this level is newly appeared (row should be inserted/flashed). */
  added?: boolean;
  /** Directional flash tint for the tick (buy = bid side up, sell = ask). */
  flash?: BookSide;
};

/** Top-level patch set: cell patches + removed keys + spread-strip update. */
export type LadderPatchSet = {
  seq: number;
  patches: LadderPatch[];
  /** Price keys present before but gone now (rows to remove). */
  removed: { side: BookSide; key: string }[];
  spread: string;
  mid: string;
  spreadPct: string;
};

/**
 * Deterministic diff: given the previously rendered ladder and a freshly built
 * one, produce the minimal set of cell patches. Only levels whose size / total
 * / depth changed emit a patch; unchanged levels are skipped. This is the
 * "new frame -> patch instructions" pure function the P2 unit tests pin.
 */
export function diffLadder(prev: Ladder, next: Ladder): LadderPatchSet {
  const patches: LadderPatch[] = [];
  const removed: { side: BookSide; key: string }[] = [];

  for (const side of ["bid", "ask"] as const) {
    const prevRows = side === "bid" ? prev.bids : prev.asks;
    const nextRows = side === "bid" ? next.bids : next.asks;
    const prevByKey = new Map(prevRows.map((r) => [r.key, r]));
    const nextByKey = new Map(nextRows.map((r) => [r.key, r]));

    for (const row of nextRows) {
      const before = prevByKey.get(row.key);
      if (!before) {
        patches.push({
          side,
          key: row.key,
          size: formatSize(row.size),
          total: formatSize(row.total),
          depth: row.depth,
          added: true,
          flash: side,
        });
        continue;
      }
      const patch: LadderPatch = { side, key: row.key };
      let changed = false;
      if (row.size !== before.size) {
        patch.size = formatSize(row.size);
        patch.flash = side;
        changed = true;
      }
      if (row.total !== before.total) {
        patch.total = formatSize(row.total);
        changed = true;
      }
      if (row.depth !== before.depth) {
        patch.depth = row.depth;
        changed = true;
      }
      if (changed) patches.push(patch);
    }
    for (const row of prevRows) {
      if (!nextByKey.has(row.key)) removed.push({ side, key: row.key });
    }
  }

  return {
    seq: next.seq,
    patches,
    removed,
    spread: formatPrice(next.spread),
    mid: formatPrice(next.mid),
    spreadPct: `${next.spreadPct.toFixed(3)}%`,
  };
}

// --- Formatting (shared so SSR text === patch text) -------------------------

export function formatPrice(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function formatSize(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
