import { createPageMetadata } from "@mvp/runtime/seo";
import type { Metadata } from "next";
import { tradePageManifest } from "./manifest";

/**
 * Page metadata. Title/description come from this page's own
 * `PageManifest.seo`; the canonical URL, `hreflang` alternates, Open Graph and
 * Twitter cards and the robots directive come from `@mvp/runtime/seo` so all
 * seven pages emit the same shape against the same public origin
 * (`PUBLIC_SITE_ORIGIN`).
 *
 * Dynamic segment: the canonical points at the default symbol so the
 * terminal has ONE indexable URL instead of one per symbol.
 */
export const metadata: Metadata = createPageMetadata({
  title: tradePageManifest.seo.title,
  description: tradePageManifest.seo.description,
  path: "/trade/BTC",
});
