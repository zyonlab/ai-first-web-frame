import type { Metadata } from "next";
import { portfolioPageManifest } from "./manifest";

export const metadata: Metadata = {
  title: portfolioPageManifest.seo.title,
  description: portfolioPageManifest.seo.description,
};
