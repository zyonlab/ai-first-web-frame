import {
  type AssetHtmlTag,
  collectAssets,
  createAssetHtmlTags,
} from "@mvp/assets";
import { baseResetCss, createAllThemeVariables } from "@mvp/design-system";
import type { ReactNode } from "react";
import { vaultsSeoCopy } from "../src/metadata";
import { vaultsLayoutCss } from "../src/render";

export { metadata } from "../src/metadata";

/**
 * Theme + i18n asset tags for the vaults page. The design-system is the single
 * CSS source (spine §11): we inject the base reset, all theme variable blocks
 * (light + dark, attribute-driven), and the vaults layout CSS through the
 * `@mvp/assets` plane. `data-theme` is set by the shell; this page paints the
 * default (light) with zero JS when the attribute is absent.
 */
const assetTags = createAssetHtmlTags(
  collectAssets({
    themes: [
      {
        name: "design-system-reset",
        content: baseResetCss,
        order: 1,
      },
      {
        name: "design-system-tokens",
        content: createAllThemeVariables(),
        order: 2,
      },
      {
        name: "vaults-layout",
        content: vaultsLayoutCss,
        order: 3,
      },
    ],
    i18n: [
      {
        locale: "en-US",
        namespace: "vaults",
        messages: { title: vaultsSeoCopy.title },
        order: 4,
      },
      {
        locale: "zh-CN",
        namespace: "vaults",
        messages: { title: "MVP 永续 — 金库" },
        order: 5,
      },
    ],
  }),
);

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="system">
      <head>
        {assetTags.map((tag) => (
          <AssetTag key={assetTagKey(tag)} tag={tag} />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}

function assetTagKey(tag: AssetHtmlTag): string {
  const attributes = tag.attributes;
  return String(
    attributes.id ??
      attributes.href ??
      attributes.src ??
      attributes["data-theme"] ??
      attributes["data-locale"] ??
      tag.tag,
  );
}

function AssetTag({ tag }: { tag: AssetHtmlTag }) {
  if (tag.tag === "link") return <link {...tag.attributes} />;
  if (tag.tag === "style")
    return (
      <style
        {...tag.attributes}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: asset plane emits trusted framework-owned theme CSS.
        dangerouslySetInnerHTML={{ __html: tag.content ?? "" }}
      />
    );
  return (
    <script
      {...tag.attributes}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: asset plane emits trusted framework-owned JSON/script descriptors.
      dangerouslySetInnerHTML={{ __html: tag.content ?? "" }}
    />
  );
}
