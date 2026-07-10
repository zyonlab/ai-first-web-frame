import type { ReactElement } from "react";

/**
 * `AppNav` — the framework's server-safe global top navigation.
 *
 * Design constraints (docs 05 + 06):
 * - Pure server-rendered React: the brand + primary links + preference controls
 *   are plain `<a>`s, so navigation and theme/locale switching are fully usable
 *   with **no JavaScript**. Because it is rendered inside each page's own React
 *   tree (not injected as a string by the shell), its SSR output hydrates
 *   byte-for-byte and never triggers a React #418 hydration mismatch.
 * - No hard-coded colors: styling reads the design-system `--mvp-*` semantic
 *   variables (injected into `<head>` by each page's asset plane). Structure and
 *   copy are migrated verbatim from the former `shell-gateway` `renderShellNav`.
 * - Theme/locale controls GET the shell's `/_shell/theme` + `/_shell/locale`
 *   endpoints (which write the cookie and 302 back), so switching works without
 *   a framework too.
 */

/** Theme preference — mirrors `@mvp/trade-prefs` `ThemePreference` without importing it. */
export type AppNavTheme = "light" | "dark" | "system";

/** Locale preference — mirrors `@mvp/trade-prefs` `LocalePreference`. */
export type AppNavLocale = "en" | "zh";

export type AppNavProps = {
  /** The current page's path (e.g. `/trade/BTC`), used for active-link matching. */
  currentPath: string;
  /** Resolved theme preference, used to label the theme toggle + its next value. */
  theme: AppNavTheme;
  /** Resolved locale preference, used to label the locale toggle + its next value. */
  locale: AppNavLocale;
  /** Last-viewed symbol; the `Trade` link deep-links to it (defaults to `BTC`). */
  lastSymbol?: string;
};

/** A primary navigation entry (pure SSR `<a>`). */
type AppNavLink = {
  /** Stable id, also used as the active-match key. */
  id: string;
  /** Visible label. */
  label: string;
  /** Href to navigate to. */
  href: string;
  /** Path prefix that marks this link active (defaults to `href`). */
  match?: string;
};

/** Short human labels for the locale switch control. */
const LOCALE_LABEL: Record<AppNavLocale, string> = {
  en: "EN",
  zh: "中文",
};

/** Cycle order for the no-JS theme control (light -> dark -> system -> light). */
const THEME_CYCLE: Record<AppNavTheme, AppNavTheme> = {
  light: "dark",
  dark: "system",
  system: "light",
};

const THEME_LABEL: Record<AppNavTheme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const THEME_GLYPH: Record<AppNavTheme, string> = {
  light: "☀",
  dark: "☾",
  system: "◐",
};

/**
 * Primary navigation, in bar order. `Trade` deep-links to the last-viewed symbol
 * when supplied, else `/trade/BTC` (06 §1.2 item 2).
 */
export function primaryNavLinks(lastSymbol?: string): AppNavLink[] {
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
function isActive(link: AppNavLink, pathname: string): boolean {
  const prefix = link.match ?? link.href;
  if (prefix === "/") return pathname === "/";
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The global top navigation, rendered as pure SSR React. Brand + primary links
 * are plain anchors (`aria-current="page"` on the active item). Theme and locale
 * controls are plain links that GET `/_shell/theme` and `/_shell/locale` (no-JS
 * safe); the shell writes the cookie and 302s back so the next SSR render paints
 * the new preference with no flash.
 */
export function AppNav({
  currentPath,
  theme,
  locale,
  lastSymbol,
}: AppNavProps): ReactElement {
  const pathname = currentPath || "/";
  const links = primaryNavLinks(lastSymbol);
  const returnTo = encodeURIComponent(pathname);
  const nextTheme = THEME_CYCLE[theme];
  const otherLocale: AppNavLocale = locale === "en" ? "zh" : "en";
  const symbol = normalizeSymbol(lastSymbol) ?? "BTC";

  return (
    <header className="mvp-shell-nav" data-shell-nav="true">
      <nav className="mvp-shell-nav-inner" aria-label="Primary">
        <div className="mvp-shell-nav-left">
          <a className="mvp-shell-brand" href="/" aria-label="MVP Perps home">
            <span className="mvp-shell-brand-mark" aria-hidden="true">
              ◆
            </span>
            <span className="mvp-shell-brand-name">MVP Perps</span>
          </a>
          <div className="mvp-shell-primary">
            {links.map((link) => {
              const active = isActive(link, pathname);
              return (
                <a
                  key={link.id}
                  className={
                    active
                      ? "mvp-shell-navlink mvp-shell-navlink--active"
                      : "mvp-shell-navlink"
                  }
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                >
                  {link.label}
                </a>
              );
            })}
          </div>
        </div>
        <div className="mvp-shell-nav-right">
          <a
            className="mvp-shell-control mvp-shell-symbol"
            data-shell-control="symbol"
            href={`/trade/${symbol}`}
            aria-label={`Active symbol ${symbol}`}
          >
            <span className="mvp-shell-symbol-name" data-mono>
              {symbol}
            </span>
          </a>
          <a
            className="mvp-shell-control"
            data-shell-control="locale"
            href={`/_shell/locale?value=${otherLocale}&returnTo=${returnTo}`}
            title={`Language: ${LOCALE_LABEL[locale]}`}
            aria-label={`Switch language, current ${LOCALE_LABEL[locale]}`}
          >
            <span aria-hidden="true">🌐</span>
            <span className="mvp-shell-control-label">
              {LOCALE_LABEL[locale]}
            </span>
          </a>
          <a
            className="mvp-shell-control"
            data-shell-control="theme"
            href={`/_shell/theme?value=${nextTheme}&returnTo=${returnTo}`}
            title={`Theme: ${THEME_LABEL[theme]} (switch to ${THEME_LABEL[nextTheme]})`}
            aria-label={`Switch theme, current ${THEME_LABEL[theme]}`}
          >
            <span aria-hidden="true">{THEME_GLYPH[theme]}</span>
            <span className="mvp-shell-control-label">
              {THEME_LABEL[theme]}
            </span>
          </a>
          <a
            className="mvp-shell-control mvp-shell-wallet"
            data-shell-control="wallet"
            href="/portfolio"
            aria-label="Connect wallet"
          >
            Connect
          </a>
        </div>
      </nav>
    </header>
  );
}

/**
 * Scoped nav CSS. Reads only design-system `--mvp-*` semantic tokens (no
 * hard-coded colors). Each page injects this once through its asset plane
 * alongside the theme tokens, mirroring the former shell-injected stylesheet.
 * `prefix` defaults to the design-system `mvp` token prefix.
 */
export function appNavCss(prefix = "mvp"): string {
  const p = prefix;
  return `
.mvp-shell-nav{position:sticky;top:0;z-index:var(--${p}-zIndex-sticky,100);background:var(--${p}-color-surface-1);color:var(--${p}-color-ink);border-block-end:1px solid var(--${p}-color-border);font-family:var(--${p}-font-control,system-ui,sans-serif);}
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
@media (max-width:767px){.mvp-shell-primary .mvp-shell-navlink[href^="/vaults"],.mvp-shell-primary .mvp-shell-navlink[href^="/referrals"]{display:none;}.mvp-shell-control-label{display:none;}}
@media (max-width:639px){.mvp-shell-brand-name{display:none;}}`.trim();
}
