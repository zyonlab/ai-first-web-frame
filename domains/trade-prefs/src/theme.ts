import type { StoragePolicy } from "@mvp/contracts";
import { type CookieWrite, readPrefCookie, writePrefCookie } from "./cookies";

/**
 * Theme preference: `light` | `dark` | `system`.
 *
 * Privacy: **public** (theme is chrome, not user data). Partition: **none**
 * (`canUseSharedStorage` returns true). TTL: ~1 year. SSR: yes — the cookie is
 * read on the server to render the correct first paint with no flash
 * (05-i18n-and-theming.md §5/§6). Client: yes — the cookie is **not**
 * `HttpOnly` so the `ThemeToggle` island can read/write it.
 */
export type ThemePreference = "light" | "dark" | "system";

const THEME_VALUES = new Set<ThemePreference>(["light", "dark", "system"]);

/** Cookie name for the theme preference — a fixed, client-readable name. */
export const THEME_COOKIE = "mvp_theme";

/** One year, in seconds. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Default theme when no cookie is present, matching `RequestContext.theme`. */
export const DEFAULT_THEME: ThemePreference = "system";

/**
 * Public, unpartitioned, SSR-readable cookie policy for the theme preference.
 * Kept for documentation/introspection; the actual read/write uses a fixed
 * cookie name (`mvp_theme`) rather than a partitioned storage key so the
 * `ThemeToggle` island can read/write it by name via `document.cookie`.
 */
export const themePreferencePolicy: StoragePolicy = {
  id: "theme-preference",
  adapter: "cookie",
  privacy: "public",
  ttl: ONE_YEAR_SECONDS,
  partitionBy: [],
  encrypted: false,
  ssr: true,
};

function normalizeTheme(value: unknown): ThemePreference | undefined {
  return typeof value === "string" && THEME_VALUES.has(value as ThemePreference)
    ? (value as ThemePreference)
    : undefined;
}

/**
 * Reads the theme preference from an incoming `Cookie` header, falling back to
 * {@link DEFAULT_THEME} when the cookie is missing or holds an unknown value.
 */
export function readThemePreference(cookieHeader = ""): ThemePreference {
  return (
    normalizeTheme(readPrefCookie(cookieHeader, THEME_COOKIE)) ?? DEFAULT_THEME
  );
}

export type WriteThemePreferenceResult = {
  theme: ThemePreference;
  /** Raw `Set-Cookie` header to emit on the response. */
  setCookie: string;
  /** Structured cookie write for Next.js `cookies().set(...)`. */
  cookieWrite: CookieWrite;
};

/**
 * Persists the theme preference under the fixed `mvp_theme` cookie (public,
 * non-HttpOnly, `SameSite=Lax`, `Secure`) and returns the `Set-Cookie` header
 * plus a structured cookie write.
 */
export function writeThemePreference(
  theme: ThemePreference,
): WriteThemePreferenceResult {
  const { setCookie, cookieWrite } = writePrefCookie(
    THEME_COOKIE,
    theme,
    ONE_YEAR_SECONDS,
  );
  return { theme, setCookie, cookieWrite };
}
