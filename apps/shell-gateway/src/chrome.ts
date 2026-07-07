/**
 * Shell-owned global chrome: the SSR top navigation, the theme/i18n asset head,
 * and the composition that wraps proxied page HTML.
 *
 * Design constraints (docs 05 + 06):
 * - The core navigation is **pure server-rendered HTML** (brand + primary nav are
 *   plain `<a>`s) so it is fully usable with no JavaScript. Theme/locale controls
 *   are also plain links (GET to a shell endpoint that writes the cookie and
 *   redirects back), so switching works without a framework too. Islands
 *   (dropdowns / command palette) are a later, optional progressive enhancement
 *   and never own first paint of navigation.
 * - Theming is flash-free: the correct `data-theme` is decided on the server from
 *   the `mvp_theme` cookie and both light + dark token blocks ship in the first
 *   byte of HTML (design-system `createAllThemeVariables`). `system` resolves via
 *   CSS media queries only — no blocking theme-guessing script.
 * - No hard-coded colors: nav styling reads the design-system `--mvp-*` semantic
 *   variables injected into the head.
 */

import {
  baseResetCss,
  createAllThemeVariables,
  TOKEN_PREFIX,
} from "@mvp/design-system";
import type { LocalePreference, ThemePreference } from "@mvp/storage";

/** BCP-47 tags emitted on `<html lang>` for each short locale. */
const LOCALE_LANG: Record<LocalePreference, string> = {
  en: "en-US",
  zh: "zh-CN",
};

/** Short human labels for the locale switch control. */
const LOCALE_LABEL: Record<LocalePreference, string> = {
  en: "EN",
  zh: "中文",
};

/** Cycle order for the no-JS theme control (light -> dark -> system -> light). */
const THEME_CYCLE: Record<ThemePreference, ThemePreference> = {
  light: "dark",
  dark: "system",
  system: "light",
};

const THEME_LABEL: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/** A primary navigation entry (pure SSR `<a>`). */
export type ShellNavLink = {
  /** Stable id, also used as the active-match key. */
  id: string;
  /** Visible label. */
  label: string;
  /** Href to navigate to. */
  href: string;
  /** Path prefix that marks this link active (defaults to `href`). */
  match?: string;
};

/**
 * Primary navigation, in bar order. `Trade` deep-links to the last-viewed symbol
 * when supplied, else `/trade/BTC` (06 §1.2 item 2).
 */
export function primaryNavLinks(lastSymbol?: string): ShellNavLink[] {
  const symbol = normalizeSymbol(lastSymbol) ?? "BTC";
  return [
    { id: "trade", label: "Trade", href: `/trade/${symbol}`, match: "/trade" },
    { id: "markets", label: "Markets", href: "/markets" },
    { id: "portfolio", label: "Portfolio", href: "/portfolio" },
    { id: "vaults", label: "Vaults", href: "/vaults" },
    { id: "referrals", label: "Referrals", href: "/referrals" },
  ];
}

function normalizeSymbol(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const upper = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,10}$/.test(upper) ? upper : undefined;
}

/** True when `pathname` falls under the link's active match prefix. */
function isActive(link: ShellNavLink, pathname: string): boolean {
  const prefix = link.match ?? link.href;
  if (prefix === "/") return pathname === "/";
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Map a short locale to its BCP-47 `<html lang>` tag. */
export function localeToLang(locale: LocalePreference): string {
  return LOCALE_LANG[locale] ?? LOCALE_LANG.en;
}

/**
 * The flash-free theme + i18n head: the design-system base reset, the base
 * variable block, and both light + dark theme token sets, plus a `system`
 * resolution block that maps `data-theme="system"` onto the OS preference via
 * CSS media queries only. Emitted once per response, inside `<head>`, nonce'd so
 * it stays CSP-clean when the policy is tightened to a `style-src` nonce.
 */
export function renderThemeHead(nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${escapeAttr(nonce)}"` : "";
  const themeCss = createAllThemeVariables();
  const systemCss = createSystemThemeCss();
  const navCss = shellNavCss();
  return (
    `<style data-shell="reset"${nonceAttr}>${baseResetCss}</style>` +
    `<style data-shell="theme"${nonceAttr}>${themeCss}${systemCss}</style>` +
    `<style data-shell="nav"${nonceAttr}>${navCss}</style>`
  );
}

/**
 * `system` theme fallback: when `data-theme="system"`, resolve the `--mvp-color-*`
 * values from the OS preference. Built from the same design-system theme blocks so
 * it never drifts from `createThemeVariables` — we re-scope the emitted selectors
 * to `[data-theme="system"]` inside the matching media query.
 */
function createSystemThemeCss(prefix: string = TOKEN_PREFIX): string {
  const all = createAllThemeVariables(prefix);
  const dark = extractThemeBlock(all, "dark");
  const light = extractThemeBlock(all, "light");
  return (
    `@media (prefers-color-scheme:dark){:where([data-theme="system"]){${dark}}}` +
    `@media (prefers-color-scheme:light){:where([data-theme="system"]){${light}}}`
  );
}

/** Pull the declaration body of a theme block out of the combined CSS string. */
function extractThemeBlock(css: string, theme: string): string {
  const marker = `:where([data-theme="${theme}"]){`;
  const start = css.indexOf(marker);
  if (start === -1) return "";
  const from = start + marker.length;
  const end = css.indexOf("}", from);
  return end === -1 ? "" : css.slice(from, end);
}

/**
 * Renders the global top navigation as pure SSR HTML. Brand + primary links are
 * plain anchors (`aria-current="page"` on the active item). Theme and locale
 * controls are plain links that GET `/_shell/theme` and `/_shell/locale` (no-JS
 * safe); an optional inline enhancement script may upgrade the theme link to an
 * instant in-place flip, but the link remains the fallback.
 */
export function renderShellNav(input: {
  pathname: string;
  theme: ThemePreference;
  locale: LocalePreference;
  lastSymbol?: string;
  nonce?: string;
}): string {
  const { pathname, theme, locale } = input;
  const links = primaryNavLinks(input.lastSymbol);
  const returnTo = encodeURIComponent(pathname || "/");

  const brand = `<a class="mvp-shell-brand" href="/" aria-label="MVP Perps home"><span class="mvp-shell-brand-mark" aria-hidden="true">◆</span><span class="mvp-shell-brand-name">MVP Perps</span></a>`;

  const items = links
    .map((link) => {
      const active = isActive(link, pathname);
      const current = active ? ' aria-current="page"' : "";
      const activeClass = active
        ? "mvp-shell-navlink mvp-shell-navlink--active"
        : "mvp-shell-navlink";
      return `<a class="${activeClass}" href="${escapeAttr(link.href)}"${current}>${escapeHtml(link.label)}</a>`;
    })
    .join("");

  const nextTheme = THEME_CYCLE[theme];
  const themeControl =
    `<a class="mvp-shell-control" data-shell-control="theme" ` +
    `href="/_shell/theme?value=${nextTheme}&amp;returnTo=${returnTo}" ` +
    `title="Theme: ${THEME_LABEL[theme]} (switch to ${THEME_LABEL[nextTheme]})" ` +
    `aria-label="Switch theme, current ${THEME_LABEL[theme]}">` +
    `<span aria-hidden="true">${theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐"}</span>` +
    `<span class="mvp-shell-control-label">${THEME_LABEL[theme]}</span></a>`;

  const otherLocale: LocalePreference = locale === "en" ? "zh" : "en";
  const localeControl =
    `<a class="mvp-shell-control" data-shell-control="locale" ` +
    `href="/_shell/locale?value=${otherLocale}&amp;returnTo=${returnTo}" ` +
    `title="Language: ${LOCALE_LABEL[locale]}" ` +
    `aria-label="Switch language, current ${LOCALE_LABEL[locale]}">` +
    `<span aria-hidden="true">🌐</span>` +
    `<span class="mvp-shell-control-label">${LOCALE_LABEL[locale]}</span></a>`;

  const symbol = normalizeSymbol(input.lastSymbol) ?? "BTC";
  const symbolControl =
    `<a class="mvp-shell-control mvp-shell-symbol" data-shell-control="symbol" ` +
    `href="/trade/${symbol}" aria-label="Active symbol ${symbol}">` +
    `<span class="mvp-shell-symbol-name" data-mono>${escapeHtml(symbol)}</span></a>`;

  const walletControl =
    `<a class="mvp-shell-control mvp-shell-wallet" data-shell-control="wallet" ` +
    `href="/portfolio" aria-label="Connect wallet">Connect</a>`;

  return (
    `<header class="mvp-shell-nav" data-shell-nav="true">` +
    `<nav class="mvp-shell-nav-inner" aria-label="Primary">` +
    `<div class="mvp-shell-nav-left">${brand}<div class="mvp-shell-primary" role="list">${items}</div></div>` +
    `<div class="mvp-shell-nav-right">${symbolControl}${localeControl}${themeControl}${walletControl}</div>` +
    `</nav></header>`
  );
}

/**
 * Wraps proxied page HTML with the shell chrome: sets `<html lang>` +
 * `data-theme`, injects the theme/i18n head, and mounts the top nav above the
 * page content. The existing `data-shell-gateway` route marker is preserved
 * (inside the nav) so downstream observability/tests keep working.
 */
export function wrapShellChrome(input: {
  html: string;
  pathname: string;
  page: string;
  theme: ThemePreference;
  locale: LocalePreference;
  lastSymbol?: string;
  nonce?: string;
}): string {
  const { html, pathname, page, theme, locale, nonce } = input;
  let out = html;

  const lang = localeToLang(locale);

  // Set data-theme + lang on <html>, or synthesize the tag if the page omitted it.
  if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, (_match, attrs: string) => {
      let a = stripAttr(attrs, "data-theme");
      a = stripAttr(a, "lang");
      return `<html${a} lang="${escapeAttr(lang)}" data-theme="${escapeAttr(theme)}">`;
    });
  } else {
    out = `<html lang="${escapeAttr(lang)}" data-theme="${escapeAttr(theme)}">${out}</html>`;
  }

  const head = renderThemeHead(nonce);
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${head}`);
  } else if (/<body[^>]*>/i.test(out)) {
    out = out.replace(/<body([^>]*)>/i, `<head>${head}</head><body$1>`);
  } else {
    out = `${head}${out}`;
  }

  const nav = renderShellNav({
    pathname,
    theme,
    locale,
    lastSymbol: input.lastSymbol,
    nonce,
  });
  const marker = renderRouteMarker(pathname, page, nonce);
  const chrome = `${nav}${marker}`;

  if (/<body[^>]*>/i.test(out)) {
    out = out.replace(/<body([^>]*)>/i, `<body$1>${chrome}`);
  } else {
    out = `${chrome}${out}`;
  }

  return out;
}

/**
 * The legacy route marker, kept for observability continuity (a small, hidden
 * data element carrying the matched route + page). Styling lives in the nonced
 * nav stylesheet so no inline `style=` attribute is needed.
 */
function renderRouteMarker(
  pathname: string,
  page: string,
  nonce?: string,
): string {
  const nonceAttr = nonce ? ` nonce="${escapeAttr(nonce)}"` : "";
  return `<div class="mvp-shell-marker" data-shell-gateway="true"${nonceAttr} data-shell-route="${escapeAttr(pathname)}" data-shell-page="${escapeAttr(page)}">Shell gateway route: <strong>${escapeHtml(pathname)}</strong> -&gt; ${escapeHtml(page)}</div>`;
}

/** Scoped shell-nav CSS. Reads only design-system `--mvp-*` semantic tokens. */
function shellNavCss(): string {
  const p = TOKEN_PREFIX;
  return `
.mvp-shell-nav{position:sticky;top:0;z-index:var(--${p}-zIndex-sticky,100);background:var(--${p}-color-surface-1);color:var(--${p}-color-ink);border-block-end:1px solid var(--${p}-color-border);font-family:var(--${p}-font-sans,var(--${p}-font-body,system-ui,sans-serif));}
.mvp-shell-nav-inner{display:flex;align-items:center;justify-content:space-between;gap:var(--${p}-spacing-4,1rem);padding-inline:var(--${p}-spacing-4,1rem);padding-block:var(--${p}-spacing-2,0.5rem);max-width:1440px;margin-inline:auto;}
.mvp-shell-nav-left{display:flex;align-items:center;gap:var(--${p}-spacing-5,1.5rem);min-width:0;}
.mvp-shell-brand{display:inline-flex;align-items:center;gap:var(--${p}-spacing-2,0.5rem);font-weight:700;color:var(--${p}-color-ink);white-space:nowrap;}
.mvp-shell-brand-mark{color:var(--${p}-color-accent);}
.mvp-shell-primary{display:flex;align-items:center;gap:var(--${p}-spacing-1,0.25rem);flex-wrap:wrap;}
.mvp-shell-navlink{display:inline-flex;align-items:center;padding-inline:var(--${p}-spacing-3,0.75rem);padding-block:var(--${p}-spacing-2,0.5rem);border-radius:var(--${p}-radius-sm,4px);color:var(--${p}-color-text-muted);font-weight:500;line-height:1;}
.mvp-shell-navlink:hover{color:var(--${p}-color-ink);background:var(--${p}-color-surface-2);}
.mvp-shell-navlink--active{color:var(--${p}-color-ink);box-shadow:inset 0 -2px 0 0 var(--${p}-color-accent);}
.mvp-shell-nav-right{display:flex;align-items:center;gap:var(--${p}-spacing-2,0.5rem);}
.mvp-shell-control{display:inline-flex;align-items:center;gap:var(--${p}-spacing-1,0.25rem);padding-inline:var(--${p}-spacing-2,0.5rem);padding-block:var(--${p}-spacing-1,0.25rem);border-radius:var(--${p}-radius-sm,4px);border:1px solid var(--${p}-color-border);color:var(--${p}-color-ink);font-size:0.875rem;line-height:1.2;background:var(--${p}-color-surface-1);}
.mvp-shell-control:hover{background:var(--${p}-color-surface-2);}
.mvp-shell-symbol{font-weight:600;}
.mvp-shell-wallet{border-color:var(--${p}-color-accent);color:var(--${p}-color-accent);font-weight:600;}
.mvp-shell-marker{font-size:0.75rem;color:var(--${p}-color-text-muted);background:var(--${p}-color-surface-2);padding-inline:var(--${p}-spacing-3,0.75rem);padding-block:var(--${p}-spacing-1,0.25rem);border-block-end:1px solid var(--${p}-color-border);}
@media (max-width:767px){.mvp-shell-primary .mvp-shell-navlink[href^="/vaults"],.mvp-shell-primary .mvp-shell-navlink[href^="/referrals"]{display:none;}.mvp-shell-control-label{display:none;}}
@media (max-width:639px){.mvp-shell-brand-name{display:none;}}`.trim();
}

function stripAttr(attrs: string, name: string): string {
  return attrs.replace(
    new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "gi"),
    "",
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Attribute-context escape: also neutralizes quotes. */
function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
