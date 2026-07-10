import { type CookieAttributes, parseCookieHeader } from "@mvp/storage";

/**
 * Structured representation of a cookie the caller should write onto the
 * response. Mirrors the shape used by `apps/page-product/src/recentlyViewed.ts`
 * so shell/pages can hand it to `cookies().set(...)` or push the raw
 * `Set-Cookie` header directly.
 */
export type CookieWrite = {
  name: string;
  value: string;
  maxAge?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "strict" | "lax" | "none";
  path: string;
  domain?: string;
};

/**
 * Parses an emitted `Set-Cookie` header (as produced by
 * {@link CookieStorageAdapter.toSetCookieHeaders}) into a structured
 * {@link CookieWrite}. Cookie name/value are percent-decoded because the
 * adapter percent-encodes them on the way out (a cookie name like `mvp_theme`
 * is safe, but this keeps the round-trip lossless for arbitrary names).
 */
export function parseSetCookie(header: string): CookieWrite {
  const [nameValue, ...attributeParts] = header.split(";");
  const eq = nameValue.indexOf("=");
  const name = decodeURIComponent(nameValue.slice(0, eq).trim());
  const value = decodeURIComponent(nameValue.slice(eq + 1).trim());
  const write: CookieWrite = {
    name,
    value,
    httpOnly: false,
    secure: false,
    sameSite: "lax",
    path: "/",
  };
  for (const raw of attributeParts) {
    const attribute = raw.trim();
    const lower = attribute.toLowerCase();
    if (lower === "httponly") write.httpOnly = true;
    else if (lower === "secure") write.secure = true;
    else if (lower.startsWith("max-age="))
      write.maxAge = Number(attribute.slice("max-age=".length));
    else if (lower.startsWith("path="))
      write.path = attribute.slice("path=".length);
    else if (lower.startsWith("domain="))
      write.domain = attribute.slice("domain=".length);
    else if (lower.startsWith("samesite="))
      write.sameSite = attribute
        .slice("samesite=".length)
        .toLowerCase() as CookieWrite["sameSite"];
  }
  return write;
}

/**
 * Cookie attributes for the "public, client-readable" preference cookies
 * (theme + locale): `SameSite=Lax`, `Secure`, **not** `HttpOnly` so the
 * `ThemeToggle` / `LocaleSwitcher` islands can read and write them client-side
 * (05-i18n-and-theming.md §6.1).
 */
export const PUBLIC_PREF_COOKIE_ATTRIBUTES: CookieAttributes = {
  httpOnly: false,
  secure: true,
  sameSite: "lax",
  path: "/",
};

/**
 * Reads a preference cookie by its **stable, fixed name** (e.g. `mvp_theme`).
 *
 * Theme/locale must use a fixed cookie name so both the server (SSR first paint)
 * and the client island (`document.cookie`) can find them by that name — unlike
 * `createStorage`, whose cookie name is the partitioned storage key. Returns the
 * decoded value or `undefined` when absent.
 */
export function readPrefCookie(
  cookieHeader: string,
  name: string,
): string | undefined {
  return parseCookieHeader(cookieHeader).get(name);
}

/**
 * Serializes a public preference cookie under a fixed name into a `Set-Cookie`
 * header + structured {@link CookieWrite}. Name/value are percent-encoded so
 * arbitrary values stay valid; the name should already be cookie-safe.
 */
export function writePrefCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
): { setCookie: string; cookieWrite: CookieWrite } {
  const attrs = PUBLIC_PREF_COOKIE_ATTRIBUTES;
  const segments = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAgeSeconds}`,
    `Path=${attrs.path}`,
    `SameSite=${attrs.sameSite === "lax" ? "Lax" : attrs.sameSite}`,
  ];
  if (attrs.secure) segments.push("Secure");
  if (attrs.httpOnly) segments.push("HttpOnly");
  const setCookie = segments.join("; ");
  return {
    setCookie,
    cookieWrite: {
      name,
      value,
      maxAge: maxAgeSeconds,
      httpOnly: Boolean(attrs.httpOnly),
      secure: Boolean(attrs.secure),
      sameSite: attrs.sameSite ?? "lax",
      path: attrs.path ?? "/",
    },
  };
}
