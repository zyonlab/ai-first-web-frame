import type { Metadata } from "next";
import { marketsPageManifest } from "./manifest";

export const metadata: Metadata = {
  title: marketsPageManifest.seo.title,
  description: marketsPageManifest.seo.description,
};
