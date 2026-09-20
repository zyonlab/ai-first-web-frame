/**
 * Fragment backend proxy — the page-side half of `FragmentManifest.proxy`.
 *
 * A fragment declares `proxy: { quotes: "https://quotes.internal/v1" }`; the
 * composition gateway mounts it at `/_fragment/<fragment>/<target>/*` on the
 * public origin. The fragment's browser code then calls a same-origin path and
 * never learns the backend's real address.
 *
 * Everything here is pure: path parsing, URL joining and the escape check. The
 * gateway owns the I/O (manifest fetch, forwarding), so the part that decides
 * WHERE a request may go is unit-testable on its own — the same split the
 * static report server uses, and for the same reason.
 */

/** Public path prefix the gateway mounts fragment proxies under. */
export const FRAGMENT_PROXY_PREFIX = "/_fragment";

export type FragmentProxyRequest = {
  /** Registry fragment name. */
  fragment: string;
  /** Key in the fragment manifest's `proxy` record. */
  target: string;
  /** Remaining path segments, without a leading slash (may be empty). */
  rest: string;
};

/**
 * Parses `/_fragment/<fragment>/<target>/<rest...>`. Returns null for anything
 * that is not a complete fragment+target pair, so a malformed path 404s instead
 * of being forwarded somewhere surprising.
 */
export function parseFragmentProxyPath(
  pathname: string,
): FragmentProxyRequest | null {
  if (!pathname.startsWith(`${FRAGMENT_PROXY_PREFIX}/`)) return null;
  const segments = pathname
    .slice(FRAGMENT_PROXY_PREFIX.length + 1)
    .split("/")
    .filter((segment) => segment.length > 0);
  if (segments.length < 2) return null;
  const [fragment, target, ...rest] = segments;
  // `..` never survives into a forwarded path: `buildFragmentProxyUrl` would
  // reject it anyway, but rejecting here keeps the reason legible.
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  return { fragment, target, rest: rest.join("/") };
}

/**
 * Joins a manifest-declared target base with the remaining path and query.
 * Returns null when the result would escape the declared base — the target
 * comes from a fragment's own manifest, but the path after it comes from the
 * browser, so the base is the boundary that must hold.
 */
export function buildFragmentProxyUrl(
  targetBase: string,
  rest: string,
  search = "",
  /**
   * The declaring fragment's own `serviceUrl`, used when `targetBase` is a
   * root-relative path (`/account`). Without it a relative target is
   * unresolvable and the call returns null rather than guessing an origin.
   */
  serviceUrl?: string,
): string | null {
  let base: URL;
  try {
    base = targetBase.startsWith("/")
      ? new URL(targetBase, serviceUrl)
      : new URL(targetBase);
  } catch {
    return null;
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") return null;
  const basePath = base.pathname.endsWith("/")
    ? base.pathname
    : `${base.pathname}/`;

  // An empty remainder targets the declared base ITSELF, so the base path is
  // used verbatim — appending the directory slash here would turn `/account`
  // into `/account/`, which Fastify routes separately (verified: 200 vs 404).
  // Wiring the first real consumer is what surfaced this.
  if (rest === "") {
    const root = new URL(base.toString());
    root.search = search.startsWith("?") ? search.slice(1) : search;
    return root.toString();
  }

  let candidate: URL;
  try {
    candidate = new URL(rest, new URL(basePath, base.origin));
  } catch {
    return null;
  }
  if (candidate.origin !== base.origin) return null;
  if (!candidate.pathname.startsWith(basePath)) return null;
  candidate.search = search.startsWith("?") ? search.slice(1) : search;
  return candidate.toString();
}

/** Resolution outcome, so a caller can answer 404 vs 502 correctly. */
export type FragmentProxyResolution =
  | { ok: true; url: string }
  | {
      ok: false;
      reason:
        | "not-a-proxy-path"
        | "unknown-fragment"
        | "unknown-target"
        | "invalid-target";
    };

/**
 * Full resolution from an inbound path to an upstream URL, given the fragment's
 * declared proxy map. Keeping this separate from the fetch means the gateway's
 * route handler has no routing logic of its own.
 */
export function resolveFragmentProxy(options: {
  pathname: string;
  search?: string;
  /** `proxy` record of the named fragment's manifest, or null if unknown. */
  proxyTargets: (fragment: string) => Record<string, string> | null;
  /**
   * The named fragment's own `serviceUrl`, for resolving root-relative targets.
   * Omitting it makes relative targets `invalid-target` instead of silently
   * resolving against some other origin.
   */
  serviceUrlFor?: (fragment: string) => string | undefined;
}): FragmentProxyResolution {
  const parsed = parseFragmentProxyPath(options.pathname);
  if (!parsed) return { ok: false, reason: "not-a-proxy-path" };
  const targets = options.proxyTargets(parsed.fragment);
  if (!targets) return { ok: false, reason: "unknown-fragment" };
  const base = targets[parsed.target];
  if (!base) return { ok: false, reason: "unknown-target" };
  const url = buildFragmentProxyUrl(
    base,
    parsed.rest,
    options.search ?? "",
    options.serviceUrlFor?.(parsed.fragment),
  );
  return url ? { ok: true, url } : { ok: false, reason: "invalid-target" };
}
