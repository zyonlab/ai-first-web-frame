import type { Metadata } from "next";
import { tradePageManifest } from "./manifest";

export const metadata: Metadata = {
  title: tradePageManifest.seo.title,
  description: tradePageManifest.seo.description,
};
