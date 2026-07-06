import type { Metadata } from "next";
import { homePageManifest } from "./manifest";

export const metadata: Metadata = {
  title: homePageManifest.seo.title,
  description: homePageManifest.seo.description,
};
