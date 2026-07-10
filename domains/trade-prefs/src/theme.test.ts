import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  readThemePreference,
  THEME_COOKIE,
  writeThemePreference,
} from "./theme";

/** Turns an emitted `Set-Cookie` header into an incoming `Cookie` header. */
function toCookieHeader(setCookie: string): string {
  return setCookie.split(";")[0];
}

describe("theme preference", () => {
  it("writes under the fixed, client-readable cookie name", () => {
    const { cookieWrite, setCookie } = writeThemePreference("dark");
    // The whole point of the fix: a stable name islands can read by, NOT a
    // partitioned storage key.
    expect(cookieWrite.name).toBe(THEME_COOKIE);
    expect(THEME_COOKIE).toBe("mvp_theme");
    expect(setCookie.startsWith("mvp_theme=")).toBe(true);
  });

  it("round-trips a written theme back through the cookie", () => {
    const { setCookie } = writeThemePreference("dark");
    expect(readThemePreference(toCookieHeader(setCookie))).toBe("dark");
  });

  it("emits a public, non-HttpOnly, Lax, Secure, 1yr cookie for islands", () => {
    const { cookieWrite } = writeThemePreference("light");
    expect(cookieWrite.value).toBe("light");
    expect(cookieWrite.httpOnly).toBe(false);
    expect(cookieWrite.secure).toBe(true);
    expect(cookieWrite.sameSite).toBe("lax");
    expect(cookieWrite.maxAge).toBe(60 * 60 * 24 * 365);
  });

  it("falls back to the default theme when missing or unknown", () => {
    expect(readThemePreference("")).toBe(DEFAULT_THEME);
    expect(readThemePreference("other=1")).toBe(DEFAULT_THEME);
    expect(readThemePreference("mvp_theme=neon")).toBe(DEFAULT_THEME);
  });
});
