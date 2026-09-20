/**
 * Page-level SEO and diagnostics policy.
 *
 * Every composed page previously exported only `{ title, description }`, so the
 * site shipped with no canonical URLs, no social cards, no language alternates —
 * and no `robots.txt`/`sitemap.xml` anywhere in the repo. Because the shell
 * gateway and each page app answer on different origins, the missing canonical
 * is the expensive one: the same document is reachable at two hosts.
 *
 * This module is framework-level policy, not per-page copy: pages pass their
 * own title/description/path and get a complete metadata object back.
 */

/** Origin the public site is served from when `PUBLIC_SITE_ORIGIN` is unset. */
export const DEFAULT_SITE_ORIGIN = "http://localhost:4100";

/** Locales the site publishes, as BCP-47 tags mapped to their short form. */
export const SITE_LOCALES = { en: "en-US", zh: "zh-CN" } as const;

export type SiteLocale = keyof typeof SITE_LOCALES;

export function resolveSiteOrigin(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.PUBLIC_SITE_ORIGIN;
  if (!raw) return DEFAULT_SITE_ORIGIN;
  try {
    return new URL(raw).origin;
  } catch {
    // A malformed override must not silently produce `undefined/product/1`
    // canonicals; fall back and say so once at boot.
    console.warn(
      `[runtime/seo] PUBLIC_SITE_ORIGIN="${raw}" is not a valid URL; using ${DEFAULT_SITE_ORIGIN}`,
    );
    return DEFAULT_SITE_ORIGIN;
  }
}

export type PageMetadataInput = {
  title: string;
  description: string;
  /** Route path as served by the shell, e.g. `/markets` or `/product/123`. */
  path: string;
  /** Overrides the site origin (tests, preview deployments). */
  origin?: string;
  /** `website` for landing/listing pages, `article` for content. */
  type?: "website" | "article";
  /** Excluded from indexing (private, per-user pages). */
  noindex?: boolean;
};

export type PageMetadata = {
  title: string;
  description: string;
  metadataBase: URL;
  alternates: {
    canonical: string;
    languages: Record<string, string>;
  };
  openGraph: {
    type: "website" | "article";
    url: string;
    title: string;
    description: string;
    siteName: string;
    locale: string;
  };
  twitter: {
    card: "summary_large_image";
    title: string;
    description: string;
  };
  robots: { index: boolean; follow: boolean };
};

/** Site name used in Open Graph payloads. */
export const SITE_NAME = "MVP Perps";

/**
 * Builds the full metadata object for a composed page: absolute canonical,
 * `hreflang` alternates for every published locale, Open Graph + Twitter cards,
 * and an explicit robots directive.
 */
export function createPageMetadata({
  title,
  description,
  path,
  origin = resolveSiteOrigin(),
  type = "website",
  noindex = false,
}: PageMetadataInput): PageMetadata {
  const base = new URL(origin);
  const canonical = new URL(path, base).toString();
  const languages: Record<string, string> = {};
  for (const tag of Object.values(SITE_LOCALES)) languages[tag] = canonical;
  languages["x-default"] = canonical;
  return {
    title,
    description,
    metadataBase: base,
    alternates: { canonical, languages },
    openGraph: {
      type,
      url: canonical,
      title,
      description,
      siteName: SITE_NAME,
      locale: SITE_LOCALES.en,
    },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: !noindex, follow: !noindex },
  };
}

/**
 * Whether a page should render its internal diagnostics sections (request
 * trace, scheduler health, per-slot strategy/source, DAG node list).
 *
 * Those sections were unconditional, so every production response carried the
 * internal dependency graph and per-slot timings as visible `<h2>` content —
 * SEO noise in the page body and an information leak in the markup. They stay
 * on by default outside production (tests, `pnpm dev`) and require an explicit
 * `MVP_DIAGNOSTICS=on` in production, which is how the compose stack keeps the
 * e2e and runtime-gate assertions working.
 */
export function isDiagnosticsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const flag = env.MVP_DIAGNOSTICS;
  if (flag === "on") return true;
  if (flag === "off") return false;
  return env.NODE_ENV !== "production";
}
