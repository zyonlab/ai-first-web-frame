import { createPageMetadata } from "@mvp/runtime/seo";
import type { Metadata } from "next";
import { portfolioPageManifest } from "./manifest";

/**
 * Page metadata. Title/description come from this page's own
 * `PageManifest.seo`; the canonical URL, `hreflang` alternates, Open Graph and
 * Twitter cards and the robots directive come from `@mvp/runtime/seo` so all
 * seven pages emit the same shape against the same public origin
 * (`PUBLIC_SITE_ORIGIN`).
 */
export const metadata: Metadata = createPageMetadata({
  title: portfolioPageManifest.seo.title,
  description: portfolioPageManifest.seo.description,
  path: "/portfolio",
  // User-private data (equity, margin usage, PnL): never indexed.
  noindex: true,
});
