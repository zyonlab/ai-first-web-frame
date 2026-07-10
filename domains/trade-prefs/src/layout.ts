import type { RequestContext, StoragePolicy } from "@mvp/contracts";
import {
  createLocalStorageAdapter,
  createStorage,
  type StorageAdapter,
  type WebStorageBackend,
} from "@mvp/storage";
import { prefsPartitionContext } from "./context";

/**
 * Layout preferences — panel collapse state, column widths, etc. — as a single
 * opaque JSON blob.
 *
 * Privacy: **user-private**, partitioned by **tenant + user**. Availability:
 * **client-local first** (a `local-storage` adapter; layout is chrome the
 * server does not need for a correct first paint). TTL: long term (~1 year;
 * `local-storage` has no native expiry, so the facade embeds `expiresAt` in the
 * envelope and honors it on read). SSR: **optional cookie mirror** — inject a
 * cookie adapter via {@link LayoutPrefsOptions.adapter} when a subset must be
 * SSR-readable; the default is client-only local storage.
 */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const LAYOUT_PREFS_KEY = "layout";

export const layoutPrefsPolicy: StoragePolicy = {
  id: "layout-prefs",
  adapter: "local-storage",
  privacy: "user-private",
  ttl: ONE_YEAR_SECONDS,
  partitionBy: ["tenant", "user"],
  encrypted: false,
  ssr: false,
};

/** Arbitrary JSON blob of layout state (panel collapse, column widths, …). */
export type LayoutPrefs = Record<string, unknown>;

export type LayoutPrefsStore<T extends LayoutPrefs = LayoutPrefs> = {
  /** Reads the stored blob, or undefined when nothing is persisted. */
  read: () => Promise<T | undefined>;
  /** Replaces the whole blob. */
  write: (prefs: T) => Promise<void>;
  /** Shallow-merges a partial patch onto the existing blob. */
  merge: (patch: Partial<T>) => Promise<T>;
  /** Removes the stored blob. */
  clear: () => Promise<void>;
};

export type LayoutPrefsOptions = {
  ctx: RequestContext;
  /**
   * Backend adapter. Omit to use the policy default (`local-storage`, reading
   * the ambient `localStorage`). Inject a {@link WebStorageBackend}-backed
   * adapter in tests, or a cookie adapter to mirror a subset for SSR.
   */
  adapter?: StorageAdapter;
  /** Convenience: build a local-storage adapter over an injected backend. */
  backend?: WebStorageBackend;
  now?: () => number;
};

/**
 * Creates a layout-preferences store bound to a request. Defaults to
 * client-local `localStorage`; inject `backend` (tests) or `adapter` (cookie
 * mirror / server-kv) to override.
 */
export function createLayoutPrefs<T extends LayoutPrefs = LayoutPrefs>({
  ctx,
  adapter,
  backend,
  now,
}: LayoutPrefsOptions): LayoutPrefsStore<T> {
  const resolvedAdapter =
    adapter ?? (backend ? createLocalStorageAdapter(backend) : undefined);
  const storage = createStorage(layoutPrefsPolicy, {
    ctx: prefsPartitionContext(ctx),
    adapter: resolvedAdapter,
    now,
  });

  async function read(): Promise<T | undefined> {
    return storage.getItem<T>(LAYOUT_PREFS_KEY);
  }

  return {
    read,
    write: (prefs) => storage.setItem(LAYOUT_PREFS_KEY, prefs),
    async merge(patch) {
      const current = (await read()) ?? ({} as T);
      const next = { ...current, ...patch } as T;
      await storage.setItem(LAYOUT_PREFS_KEY, next);
      return next;
    },
    clear: () => storage.removeItem(LAYOUT_PREFS_KEY),
  };
}
