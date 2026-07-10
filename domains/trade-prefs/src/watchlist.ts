import type { RequestContext, StoragePolicy } from "@mvp/contracts";
import { createStorage, type StorageAdapter } from "@mvp/storage";
import { prefsPartitionContext } from "./context";

/**
 * Watchlist / favorite symbols.
 *
 * Privacy: **user-private** — a watchlist is per-visitor data, so it is
 * partitioned by **tenant + user** (anonymous visitors get a stable
 * `anon:<session|tenant>` id via {@link prefsPartitionContext}). Configuring it
 * with a `public` policy throws in `createStorage` (see
 * {@link watchlistPolicyReject}), which is the privacy guarantee we want.
 * TTL: long term (~1 year). SSR: available (default `server-kv`/injected
 * adapter); a cookie adapter can be injected for SSR cookie persistence, or a
 * `local-storage` adapter for client-only use.
 */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const WATCHLIST_KEY = "symbols";
const DEFAULT_MAX_WATCHLIST = 200;

export const watchlistPolicy: StoragePolicy = {
  id: "watchlist",
  adapter: "server-kv",
  privacy: "user-private",
  ttl: ONE_YEAR_SECONDS,
  partitionBy: ["tenant", "user"],
  encrypted: false,
  ssr: true,
};

export type WatchlistStore = {
  /** All symbols currently on the watchlist, insertion order preserved. */
  list: () => Promise<string[]>;
  /** True if the symbol is on the watchlist. */
  has: (symbol: string) => Promise<boolean>;
  /** Adds a symbol (idempotent, capped); returns the updated list. */
  add: (symbol: string) => Promise<string[]>;
  /** Removes a symbol (no-op if absent); returns the updated list. */
  remove: (symbol: string) => Promise<string[]>;
  /** Adds if absent, removes if present; returns the updated list. */
  toggle: (symbol: string) => Promise<string[]>;
  /** Empties the watchlist. */
  clear: () => Promise<void>;
};

export type WatchlistOptions = {
  ctx: RequestContext;
  /**
   * Backend adapter. Omit to use the policy default (`server-kv`, in-memory
   * reference). Inject a cookie adapter for SSR cookie persistence or a
   * local-storage adapter for client-only use.
   */
  adapter?: StorageAdapter;
  now?: () => number;
  /** Cap on stored symbols (oldest dropped past the cap). Default 200. */
  maxSymbols?: number;
};

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/**
 * Creates a watchlist store bound to a request. All reads/writes go through the
 * policy-enforcing {@link createStorage} facade, partitioned by tenant + user.
 */
export function createWatchlist({
  ctx,
  adapter,
  now,
  maxSymbols = DEFAULT_MAX_WATCHLIST,
}: WatchlistOptions): WatchlistStore {
  const storage = createStorage(watchlistPolicy, {
    ctx: prefsPartitionContext(ctx),
    adapter,
    now,
  });

  async function read(): Promise<string[]> {
    return (await storage.getItem<string[]>(WATCHLIST_KEY)) ?? [];
  }

  async function write(symbols: string[]): Promise<string[]> {
    const capped = symbols.slice(0, maxSymbols);
    await storage.setItem(WATCHLIST_KEY, capped);
    return capped;
  }

  return {
    list: read,
    async has(symbol) {
      return (await read()).includes(normalizeSymbol(symbol));
    },
    async add(symbol) {
      const next = normalizeSymbol(symbol);
      const current = await read();
      if (current.includes(next)) return current;
      return write([...current, next]);
    },
    async remove(symbol) {
      const target = normalizeSymbol(symbol);
      const current = await read();
      const next = current.filter((entry) => entry !== target);
      if (next.length === current.length) return current;
      return write(next);
    },
    async toggle(symbol) {
      const target = normalizeSymbol(symbol);
      const current = await read();
      return current.includes(target)
        ? write(current.filter((entry) => entry !== target))
        : write([...current, target]);
    },
    clear: () => storage.removeItem(WATCHLIST_KEY),
  };
}
