import { expect, type Locator } from "@playwright/test";

/**
 * Fallback isolation is a deliberate, documented feature of this framework:
 * when a fragment service is unreachable, the composing page (or the
 * fragment service itself) still returns 200 with degraded markup instead of
 * failing the request. Every fallback path (the page-level default markup in
 * each app's render.ts / page.tsx, and each fragment's own createXFallback)
 * stamps `data-fallback="true"` on the fragment's root element, so that
 * attribute is the stable, page-agnostic signal this helper anchors on
 * (fallback copy text differs per page/fragment and is not a reliable
 * contract to assert against).
 *
 * Two tiers of assertion:
 *
 * - Default (lenient): live content OR fallback content passes. This is the
 *   default because fallback isolation is intentional, correct behavior —
 *   an e2e run against a partially-degraded stack should not fail outright.
 * - Strict (`E2E_STRICT=1`): only live content passes; a fallback fails the
 *   assertion. Use this tier when the full fragment stack is expected to be
 *   healthy and you want e2e to actually prove live composition works,
 *   rather than passing on every fragment silently degrading.
 */
export function isE2EStrict(): boolean {
  return process.env.E2E_STRICT === "1";
}

export type FragmentContentExpectation = {
  /** Pattern matched only when the fragment rendered live content. */
  live: string | RegExp;
  /** Pattern matched only when the fragment rendered its SSR fallback. */
  fallback: string | RegExp;
};

/**
 * Assert that a fragment slot locator is visible and carries readable
 * content, honoring the E2E_STRICT tier described above.
 */
export async function expectFragmentContent(
  locator: Locator,
  content: FragmentContentExpectation,
): Promise<void> {
  await expect(locator).toBeVisible();

  if (isE2EStrict()) {
    await expect(
      locator,
      'E2E_STRICT=1: fragment must render live content, not its SSR fallback (data-fallback="true")',
    ).not.toHaveAttribute("data-fallback", "true");
    await expect(locator).toContainText(content.live);
    return;
  }

  await expect(locator).toContainText(
    combinePatterns(content.live, content.fallback),
  );
}

function combinePatterns(a: string | RegExp, b: string | RegExp): RegExp {
  const flags =
    a instanceof RegExp ? a.flags : b instanceof RegExp ? b.flags : "";
  return new RegExp(`(?:${patternSource(a)})|(?:${patternSource(b)})`, flags);
}

function patternSource(value: string | RegExp): string {
  return value instanceof RegExp ? value.source : escapeRegExp(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
