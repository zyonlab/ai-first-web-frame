# @mvp/trade-prefs — AGENT.md

## What this package is for

`@mvp/trade-prefs` is the trade demo's user-preference persistence: theme and
locale (fixed-name public cookies), watchlist and recently-viewed symbols
(user-private, tenant+user-partitioned stores), and layout prefs (client-local
blob with an optional SSR cookie mirror). Every stateful API goes through the
policy-enforcing `createStorage` facade from `@mvp/storage` — this package
supplies the trade-domain `StoragePolicy` objects and the ergonomic stores on
top, nothing more. It was split out of `packages/storage` in the P1
re-layering phase (docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2: "packages/storage
trade prefs (watchlist, recent symbols) → domains/trade-prefs") so the
framework storage core stays domain-agnostic. It is a **domain-layer** package
(§2.1): it may import framework packages (`@mvp/contracts`, `@mvp/storage`)
but `packages/**` must never import it back — imports only point downward,
enforced by the `auditPackageLayering` dependency-audit check. Not
npm-published; the demo pages/fragments consume it as the reference for how a
domain package layers preferences over the framework storage machinery. Policy
matrix: theme/locale are **public**, unpartitioned, ~1yr, SSR-read +
client-write (non-HttpOnly cookie under a fixed name); watchlist/recent
symbols are **user-private**, partitioned by tenant + user, ~1yr / 30d, SSR
via the default `server-kv` adapter (cookie adapter injectable); layout prefs
are **user-private**, client-local-first (`local-storage`), ~1yr.

## Entry points

- `prefsPartitionContext(ctx: RequestContext): StoragePartitionContext` —
  builds the partition context all stores use. Anonymous visitors (no
  `ctx.user`) get a stable fallback id `anon:<session-id|tenant>` so
  user-private partitions stay deterministic and isolated without a login.
- **Cookie plumbing** (server-safe: all functions take/return header
  **strings**, never touch `document.cookie`):
  - `CookieWrite = { name: string, value: string, maxAge?: number, httpOnly: boolean, secure: boolean, sameSite: "strict" | "lax" | "none", path: string, domain?: string }`
    — structured cookie write for Next.js `cookies().set(...)`.
  - `parseSetCookie(header: string): CookieWrite` — parses an emitted
    `Set-Cookie` header back into a structured write (percent-decoded).
  - `PUBLIC_PREF_COOKIE_ATTRIBUTES: CookieAttributes` — `SameSite=Lax`,
    `Secure`, **not** `HttpOnly` (islands read/write these client-side).
  - `readPrefCookie(cookieHeader: string, name: string): string | undefined` —
    reads a preference cookie by its fixed name from an incoming `Cookie`
    header.
  - `writePrefCookie(name: string, value: string, maxAgeSeconds: number): { setCookie: string; cookieWrite: CookieWrite }`
    — serializes a public pref cookie under a fixed name.
- **Theme** — `ThemePreference = "light" | "dark" | "system"`,
  `THEME_COOKIE = "mvp_theme"`, `DEFAULT_THEME = "system"`,
  `themePreferencePolicy: StoragePolicy` (documentation/introspection; the
  actual read/write uses the fixed cookie name, not a partitioned storage
  key, so the `ThemeToggle` island can find it via `document.cookie`):
  - `readThemePreference(cookieHeader?: string): ThemePreference` — falls
    back to `DEFAULT_THEME` when missing or unknown.
  - `writeThemePreference(theme: ThemePreference): WriteThemePreferenceResult`
    — `{ theme, setCookie: string, cookieWrite: CookieWrite }` (1yr,
    non-HttpOnly, `SameSite=Lax`, `Secure`).
- **Locale** — `LocalePreference = "en" | "zh"`, `LOCALE_COOKIE = "mvp_locale"`,
  `DEFAULT_LOCALE = "en"`, `localePreferencePolicy: StoragePolicy`:
  - `normalizeLocale(value: unknown): LocalePreference | undefined` — BCP-47
    tag to supported short locale (`zh-CN` → `zh`); undefined if unsupported.
  - `negotiateAcceptLanguage(header: string | undefined): LocalePreference | undefined`
    — q-weighted `Accept-Language` negotiation against the ship set.
  - `resolveLocalePreference(options: { cookieHeader?: string; acceptLanguage?: string }): LocalePreference`
    — priority: cookie > `Accept-Language` > `DEFAULT_LOCALE`.
  - `readLocalePreference(cookieHeader?: string): LocalePreference` /
    `writeLocalePreference(locale: LocalePreference): WriteLocalePreferenceResult`
    — cookie-only read / fixed-name write, mirroring the theme pair.
- `createWatchlist(options: WatchlistOptions): WatchlistStore` — `options:
  { ctx: RequestContext, adapter?: StorageAdapter, now?: () => number, maxSymbols?: number = 200 }`.
  Returns `{ list(): Promise<string[]>, has(symbol: string): Promise<boolean>, add(symbol): Promise<string[]>, remove(symbol): Promise<string[]>, toggle(symbol): Promise<string[]>, clear(): Promise<void> }`.
  Symbols are normalized (trim + uppercase); `add` is idempotent; the list is
  capped at `maxSymbols`. Omitting `adapter` uses the policy default
  (`server-kv`, the in-memory reference adapter); inject a cookie adapter for
  SSR cookie persistence or a local-storage adapter for client-only use.
  `watchlistPolicy: StoragePolicy` is exported for introspection.
- `createRecentSymbols(options: RecentSymbolsOptions): RecentSymbolsStore` —
  same options shape (`maxSymbols` defaults to 10). Returns
  `{ list(): Promise<string[]>, record(symbol: string): Promise<string[]>, clear(): Promise<void> }`
  — `record` front-inserts, de-duplicates, and caps (most-recent-first), the
  same algorithm as `apps/page-product/src/recentlyViewed.ts`. 30-day TTL via
  `recentSymbolsPolicy`.
- `createLayoutPrefs<T extends LayoutPrefs = LayoutPrefs>(options: LayoutPrefsOptions): LayoutPrefsStore<T>`
  — `options: { ctx: RequestContext, adapter?: StorageAdapter, backend?: WebStorageBackend, now?: () => number }`.
  Returns `{ read(): Promise<T | undefined>, write(prefs: T): Promise<void>, merge(patch: Partial<T>): Promise<T>, clear(): Promise<void> }`
  over a single opaque JSON blob (`LayoutPrefs = Record<string, unknown>`).
  Defaults to the ambient `localStorage`; pass `backend` (tests) or `adapter`
  (cookie mirror / server-kv) to override. `layoutPrefsPolicy` exported.

## Error taxonomy

- **`StoragePolicyError`** (from `@mvp/storage`, propagated unmodified — this
  package neither catches nor wraps it):
  - `createLayoutPrefs` without `adapter`/`backend` in a runtime with no
    global `localStorage` throws
    `"localStorage is not available in this runtime; inject a WebStorageBackend"`
    — the default adapter is resolved eagerly at construction, so inject a
    backend on the server and in tests.
  - Any store's read/write throws if a required partition value is missing —
    in practice prevented by `prefsPartitionContext`'s `anon:*` user fallback
    (and `tenant` always resolves via `createRequestContext`), so hitting
    this means a hand-built `ctx` with an empty `tenant`.
  - The shipped policies themselves always pass `validateStoragePolicy`
    (user-private + `partitionBy: ["tenant", "user"]` is exactly the privacy
    pairing the validator demands); construction only throws on policies you
    mutate yourself.
- **`URIError`** — `parseSetCookie` percent-decodes name/value, so a
  malformed header not produced by `writePrefCookie` /
  `CookieStorageAdapter.toSetCookieHeaders` (e.g. a bare `%`) can throw.
- The theme/locale read path **never throws by design**: a missing cookie
  header, unknown cookie value, or unsupported language falls back to
  `DEFAULT_THEME` / `DEFAULT_LOCALE` (`readPrefCookie` just returns
  `undefined`), because a bad preference must never break SSR first paint.

## Example

```ts
import { createRequestContext } from "@mvp/request-context";
import { createMemoryStorageAdapter } from "@mvp/storage";
import {
  createLayoutPrefs,
  createRecentSymbols,
  createWatchlist,
  readThemePreference,
  resolveLocalePreference,
  writeThemePreference,
} from "@mvp/trade-prefs";

// 1. Theme: fixed-name public cookie, string in / string out (server-safe —
//    no document.cookie). The Set-Cookie header round-trips through the read.
const { setCookie, cookieWrite } = writeThemePreference("dark");
console.log(cookieWrite.name); // "mvp_theme"
console.log(cookieWrite.httpOnly); // false (the ThemeToggle island reads it)
console.log(readThemePreference(setCookie.split(";")[0])); // "dark"
console.log(readThemePreference("mvp_theme=neon")); // "system" (fallback)

// 2. Locale: cookie > Accept-Language (q-weighted) > default.
console.log(
  resolveLocalePreference({ acceptLanguage: "fr;q=0.9, zh-CN;q=0.8" }),
); // "zh" (fr is unsupported; zh-CN normalizes to zh)
console.log(resolveLocalePreference({})); // "en"

// 3. User-private stores: tenant+user partitioned via prefsPartitionContext.
const ctx = { ...createRequestContext({}), user: { id: "u1" } };
const adapter = createMemoryStorageAdapter();

const watchlist = createWatchlist({ ctx, adapter });
console.log(await watchlist.add("btc")); // ["BTC"] (normalized)
console.log(await watchlist.add("BTC")); // ["BTC"] (idempotent)
console.log(await watchlist.toggle("eth")); // ["BTC", "ETH"]

const recent = createRecentSymbols({ ctx, adapter, maxSymbols: 2 });
await recent.record("btc");
await recent.record("eth");
console.log(await recent.record("sol")); // ["SOL", "ETH"] (capped, MRU-first)

// 4. Layout prefs: inject an adapter where no localStorage exists.
const layout = createLayoutPrefs({ ctx, adapter });
await layout.write({ bookCollapsed: true, columns: 3 });
console.log(await layout.merge({ columns: 4 })); // { bookCollapsed: true, columns: 4 }
```

## Accept

```
pnpm --filter @mvp/trade-prefs test
```
Expected: Vitest exits 0. `domains/trade-prefs/src/prefs.test.ts` covers the
locale round-trip/negotiation, watchlist idempotence + per-user partition
isolation (including the anonymous `anon:*` fallback), recent-symbols
front-insert/dedupe/cap, and layout-prefs read/write/merge;
`domains/trade-prefs/src/theme.test.ts` covers the fixed `mvp_theme` cookie
name, the public/non-HttpOnly/Lax/Secure/1yr attributes, and the
default-theme fallback.
