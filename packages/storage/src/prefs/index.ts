/**
 * Trade-demo user-preference persistence, built on top of the `@mvp/storage`
 * core (`createStorage` + policy validation). Every API is partitioned and
 * privacy-checked through the existing policy machinery.
 *
 * | API | Privacy | Partition | TTL | SSR / client |
 * | --- | --- | --- | --- | --- |
 * | theme (`mvp_theme`) | public | none | ~1yr | SSR read + client write (non-HttpOnly cookie) |
 * | locale (`mvp_locale`) | public | none | ~1yr | SSR read + client write (non-HttpOnly cookie) |
 * | watchlist | user-private | tenant + user | ~1yr | SSR (default server-kv; cookie adapter injectable) |
 * | recent symbols | user-private | tenant + user | 30d | SSR (default server-kv; signed cookie injectable) |
 * | layout prefs | user-private | tenant + user | ~1yr | client-local first (localStorage); optional cookie mirror |
 */
export * from "./context";
export * from "./cookies";
export * from "./layout";
export * from "./locale";
export * from "./recentSymbols";
export * from "./theme";
export * from "./watchlist";
