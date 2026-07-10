import type { StoragePolicy } from "@mvp/contracts";
import { type CookieWrite, readPrefCookie, writePrefCookie } from "./cookies";

/**
 * Locale preference: ship set is `en` (source of truth) and `zh`
 * (05-i18n-and-theming.md §2.1). Same policy shape as the theme preference:
 * **public** privacy, **no** partition, ~1yr TTL, SSR-readable, non-HttpOnly.
 */
export type LocalePreference = "en" | "zh";

const SUPPORTED_LOCALES: readonly LocalePreference[] = ["en", "zh"];
const LOCALE_VALUES = new Set<LocalePreference>(SUPPORTED_LOCALES);

/** Cookie name for the locale preference — a fixed, client-readable name. */
export const LOCALE_COOKIE = "mvp_locale";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Default locale when nothing else resolves (05 §3.2 step 3). */
export const DEFAULT_LOCALE: LocalePreference = "en";

/**
 * Kept for documentation/introspection; the actual read/write uses the fixed
 * `mvp_locale` cookie name (see theme.ts for the rationale).
 */
export const localePreferencePolicy: StoragePolicy = {
  id: "locale-preference",
  adapter: "cookie",
  privacy: "public",
  ttl: ONE_YEAR_SECONDS,
  partitionBy: [],
  encrypted: false,
  ssr: true,
};

/**
 * Maps a BCP-47 tag (or short base) to a supported short locale. `en-US -> en`,
 * `zh-CN -> zh` (05 §2.1). Returns undefined for unsupported languages.
 */
export function normalizeLocale(value: unknown): LocalePreference | undefined {
  if (typeof value !== "string") return undefined;
  const base = value.trim().toLowerCase().split("-")[0];
  return LOCALE_VALUES.has(base as LocalePreference)
    ? (base as LocalePreference)
    : undefined;
}

/**
 * Negotiates an `Accept-Language` header against the ship set, honoring `q`
 * weights. Returns the first supported locale, or undefined if none match.
 */
export function negotiateAcceptLanguage(
  header: string | undefined,
): LocalePreference | undefined {
  if (!header) return undefined;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const entry of ranked) {
    const locale = normalizeLocale(entry.tag);
    if (locale) return locale;
  }
  return undefined;
}

/**
 * Resolves the locale in priority order (05 §3.2):
 * 1. `mvp_locale` cookie (if present + supported),
 * 2. else negotiate `Accept-Language`,
 * 3. else fall back to `en`.
 */
export function resolveLocalePreference(options: {
  cookieHeader?: string;
  acceptLanguage?: string;
}): LocalePreference {
  const fromCookie = normalizeLocale(
    readPrefCookie(options.cookieHeader ?? "", LOCALE_COOKIE),
  );
  if (fromCookie) return fromCookie;
  return negotiateAcceptLanguage(options.acceptLanguage) ?? DEFAULT_LOCALE;
}

/** Reads only the cookie-persisted locale (no header fallback). */
export function readLocalePreference(cookieHeader = ""): LocalePreference {
  return (
    normalizeLocale(readPrefCookie(cookieHeader, LOCALE_COOKIE)) ??
    DEFAULT_LOCALE
  );
}

export type WriteLocalePreferenceResult = {
  locale: LocalePreference;
  setCookie: string;
  cookieWrite: CookieWrite;
};

/**
 * Persists the locale preference under the fixed `mvp_locale` cookie (public,
 * non-HttpOnly, `SameSite=Lax`, `Secure`) plus a structured cookie write.
 */
export function writeLocalePreference(
  locale: LocalePreference,
): WriteLocalePreferenceResult {
  const { setCookie, cookieWrite } = writePrefCookie(
    LOCALE_COOKIE,
    locale,
    ONE_YEAR_SECONDS,
  );
  return { locale, setCookie, cookieWrite };
}
