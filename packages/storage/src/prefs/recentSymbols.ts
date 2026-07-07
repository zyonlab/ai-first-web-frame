import type { RequestContext, StoragePolicy } from "@mvp/contracts";
import { createStorage, type StorageAdapter } from "../index";
import { prefsPartitionContext } from "./context";

/**
 * Recently viewed symbols — the trade-demo analogue of
 * `apps/page-product/src/recentlyViewed.ts`. Most-recent-first, de-duplicated,
 * capped.
 *
 * Privacy: **user-private**, partitioned by **tenant + user** (anonymous
 * visitors get a stable `anon:*` id). TTL: 30 days (shorter than the watchlist:
 * "recent" is a rolling window, not a curated list). SSR: available; inject a
 * signed cookie adapter for the classic recently-viewed cookie behavior, or the
 * default `server-kv` adapter otherwise.
 */
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;
const RECENT_SYMBOLS_KEY = "symbols";
const DEFAULT_MAX_RECENT = 10;

export const recentSymbolsPolicy: StoragePolicy = {
  id: "recent-symbols",
  adapter: "server-kv",
  privacy: "user-private",
  ttl: THIRTY_DAYS_SECONDS,
  partitionBy: ["tenant", "user"],
  encrypted: false,
  ssr: true,
};

export type RecentSymbolsStore = {
  /** Recent symbols, most-recent-first. */
  list: () => Promise<string[]>;
  /**
   * Records a visit to `symbol`: moves it to the front, de-duplicates, and caps
   * the list. Returns the updated most-recent-first list.
   */
  record: (symbol: string) => Promise<string[]>;
  /** Empties the recent list. */
  clear: () => Promise<void>;
};

export type RecentSymbolsOptions = {
  ctx: RequestContext;
  adapter?: StorageAdapter;
  now?: () => number;
  /** Cap on retained symbols (oldest dropped past the cap). Default 10. */
  maxSymbols?: number;
};

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/**
 * Creates a recent-symbols store bound to a request. Uses the same
 * front-insert + dedupe + cap algorithm proven in `recentlyViewed.ts`.
 */
export function createRecentSymbols({
  ctx,
  adapter,
  now,
  maxSymbols = DEFAULT_MAX_RECENT,
}: RecentSymbolsOptions): RecentSymbolsStore {
  const storage = createStorage(recentSymbolsPolicy, {
    ctx: prefsPartitionContext(ctx),
    adapter,
    now,
  });

  async function read(): Promise<string[]> {
    return (await storage.getItem<string[]>(RECENT_SYMBOLS_KEY)) ?? [];
  }

  return {
    list: read,
    async record(symbol) {
      const next = normalizeSymbol(symbol);
      const current = await read();
      const updated = [
        next,
        ...current.filter((entry) => entry !== next),
      ].slice(0, maxSymbols);
      await storage.setItem(RECENT_SYMBOLS_KEY, updated);
      return updated;
    },
    clear: () => storage.removeItem(RECENT_SYMBOLS_KEY),
  };
}
