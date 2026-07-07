/**
 * Canonical trade-demo data-source id registry (contract **C5**, frozen).
 *
 * Every trade data source is addressed by a stable, normalized string id. Two
 * kinds of ids exist:
 *
 * - **Symbol-scoped** ids embed the symbol (and sometimes an interval) so that
 *   the *runtime cache key* still partitions by `params.symbol` — the id itself
 *   is human-readable (`book.l2.BTC`) while `createDataKey` does the real
 *   partitioning. Use the constructor functions below; never hand-format ids.
 * - **Global / user-scoped** ids are fixed constants (`positions`, `account`,
 *   `markets.index`, `session.wallet`).
 *
 * The mapping to the runtime feed / freshness catalog lives in
 * `docs/trade-demo/03-data-architecture.md` §1. This module is the single place
 * other fragments (A2-*) and the trace dependency graph (A5-trace) import ids
 * from — do not redefine ids elsewhere.
 *
 * ## Naming convention
 *
 * `<namespace>[.<sub>].<symbol>[.<interval>]` — lowercase namespace, the symbol
 * uppercased (matching the generator's `SYMBOL_BASE_PRICE` keys), interval kept
 * verbatim (`1m`, `5m`, ...). Global sources drop the symbol suffix.
 */

/** Namespaces used by the trade-demo source ids (the `<namespace>` prefix). */
export const SOURCE_NAMESPACES = [
  "book",
  "ticker",
  "trades",
  "positions",
  "orders",
  "account",
  "balances",
  "candles",
  "funding",
  "markets",
  "symbol",
  "leverage",
  "session",
] as const;
export type SourceNamespace = (typeof SOURCE_NAMESPACES)[number];

/** Normalizes a symbol to its canonical id form (uppercase, trimmed). */
export function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.length === 0)
    throw new Error("source id symbol must be a non-empty string");
  return normalized;
}

/** Normalizes a candle interval to its canonical id form (lowercase, trimmed). */
export function normalizeInterval(interval: string): string {
  const normalized = interval.trim().toLowerCase();
  if (normalized.length === 0)
    throw new Error("source id interval must be a non-empty string");
  return normalized;
}

/**
 * Canonical source-id constructors + global constants (contract C5).
 *
 * The symbol-scoped members are functions; the global members are constant
 * strings. Every id in the trade demo comes from here.
 */
export const sourceIds = {
  /** `book.l2.<symbol>` — realtime order book L2 ladder. */
  bookL2: (symbol: string): string => `book.l2.${normalizeSymbol(symbol)}`,
  /** `ticker.<symbol>` — near-realtime mark/last/24h change. */
  ticker: (symbol: string): string => `ticker.${normalizeSymbol(symbol)}`,
  /** `trades.<symbol>` — realtime trades tape. */
  trades: (symbol: string): string => `trades.${normalizeSymbol(symbol)}`,
  /** `candles.<symbol>.<interval>` — near-realtime live candle. */
  candles: (symbol: string, interval: string): string =>
    `candles.${normalizeSymbol(symbol)}.${normalizeInterval(interval)}`,
  /** `candles.history.<symbol>.<interval>` — ISR candle history bootstrap. */
  candlesHistory: (symbol: string, interval: string): string =>
    `candles.history.${normalizeSymbol(symbol)}.${normalizeInterval(interval)}`,
  /** `funding.<symbol>` — near-realtime funding snapshot. */
  funding: (symbol: string): string => `funding.${normalizeSymbol(symbol)}`,
  /** `symbol.meta.<symbol>` — ISR symbol metadata (tick/lot/decimals/maxLev). */
  symbolMeta: (symbol: string): string =>
    `symbol.meta.${normalizeSymbol(symbol)}`,
  /** `leverage.tiers.<symbol>` — static leverage/margin ladder. */
  leverageTiers: (symbol: string): string =>
    `leverage.tiers.${normalizeSymbol(symbol)}`,

  /** `positions` — realtime open positions (user-private). */
  positions: "positions",
  /** `orders` — realtime working/open orders (user-private). */
  orders: "orders",
  /** `account` — request-time + realtime account margin (user-private). */
  account: "account",
  /** `balances` — request-time balances/equity/withdrawable (user-private). */
  balances: "balances",
  /** `markets.index` — near-realtime markets index (public). */
  marketsIndex: "markets.index",
  /** `session.wallet` — request-time session/wallet-connect state (user-private). */
  sessionWallet: "session.wallet",
} as const;

/** The fixed (non-symbol-scoped) source ids, enumerable for the dep graph. */
export const GLOBAL_SOURCE_IDS = [
  sourceIds.positions,
  sourceIds.orders,
  sourceIds.account,
  sourceIds.balances,
  sourceIds.marketsIndex,
  sourceIds.sessionWallet,
] as const;

/** The realtime feed name a `book`/`ticker`/`trades`/`candles`/`funding` id maps to. */
export type SourceKind =
  | "book.l2"
  | "ticker"
  | "trades"
  | "candles.live"
  | "candles.history"
  | "funding"
  | "symbol.meta"
  | "leverage.tiers"
  | "positions"
  | "orders"
  | "account"
  | "balances"
  | "markets.index"
  | "session.wallet";

/** Structured parse of a source id back into its kind + symbol/interval parts. */
export type ParsedSourceId = {
  kind: SourceKind;
  symbol?: string;
  interval?: string;
};

/**
 * Parses a canonical source id back into its `kind` + `symbol`/`interval`.
 * Returns `undefined` for an unrecognized id (rather than throwing) so callers
 * building a dependency graph can skip foreign ids gracefully.
 */
export function parseSourceId(id: string): ParsedSourceId | undefined {
  switch (id) {
    case sourceIds.positions:
      return { kind: "positions" };
    case sourceIds.orders:
      return { kind: "orders" };
    case sourceIds.account:
      return { kind: "account" };
    case sourceIds.balances:
      return { kind: "balances" };
    case sourceIds.marketsIndex:
      return { kind: "markets.index" };
    case sourceIds.sessionWallet:
      return { kind: "session.wallet" };
    default:
      break;
  }
  // book.l2.<symbol>
  const book = /^book\.l2\.([A-Z0-9]+)$/.exec(id);
  if (book) return { kind: "book.l2", symbol: book[1] };
  // candles.history.<symbol>.<interval>
  const candlesHistory = /^candles\.history\.([A-Z0-9]+)\.([a-z0-9]+)$/.exec(
    id,
  );
  if (candlesHistory)
    return {
      kind: "candles.history",
      symbol: candlesHistory[1],
      interval: candlesHistory[2],
    };
  // candles.<symbol>.<interval>
  const candles = /^candles\.([A-Z0-9]+)\.([a-z0-9]+)$/.exec(id);
  if (candles)
    return {
      kind: "candles.live",
      symbol: candles[1],
      interval: candles[2],
    };
  // ticker.<symbol>
  const ticker = /^ticker\.([A-Z0-9]+)$/.exec(id);
  if (ticker) return { kind: "ticker", symbol: ticker[1] };
  // trades.<symbol>
  const trades = /^trades\.([A-Z0-9]+)$/.exec(id);
  if (trades) return { kind: "trades", symbol: trades[1] };
  // funding.<symbol>
  const funding = /^funding\.([A-Z0-9]+)$/.exec(id);
  if (funding) return { kind: "funding", symbol: funding[1] };
  // symbol.meta.<symbol>
  const symbolMeta = /^symbol\.meta\.([A-Z0-9]+)$/.exec(id);
  if (symbolMeta) return { kind: "symbol.meta", symbol: symbolMeta[1] };
  // leverage.tiers.<symbol>
  const leverageTiers = /^leverage\.tiers\.([A-Z0-9]+)$/.exec(id);
  if (leverageTiers)
    return { kind: "leverage.tiers", symbol: leverageTiers[1] };
  return undefined;
}
