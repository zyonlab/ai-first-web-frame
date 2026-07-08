import {
  type AssetHtmlTag,
  collectAssets,
  createAssetHtmlTags,
} from "@mvp/assets";
import { baseResetCss, createAllThemeVariables } from "@mvp/design-system";
import { readThemePreference, resolveLocalePreference } from "@mvp/storage";
import { AppNav, appNavCss } from "@mvp/ui/AppNav";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { vaultsSeoCopy } from "../src/metadata";
import { vaultsLayoutCss } from "../src/render";

export { metadata } from "../src/metadata";

/** BCP-47 `<html lang>` tags for each short locale (page now owns this). */
const LOCALE_LANG = { en: "en-US", zh: "zh-CN" } as const;

/**
 * Theme + i18n asset tags for the vaults page. The design-system is the single
 * CSS source (spine §11): we inject the base reset, all theme variable blocks
 * (light + dark, attribute-driven), the vaults layout CSS, and the shared
 * `AppNav` stylesheet through the `@mvp/assets` plane.
 *
 * The page — not the shell — now owns theme/locale and the top navigation, so
 * its SSR output is a self-consistent React tree that hydrates without a
 * mismatch (fixes React #418). `data-theme` is resolved from the `mvp_theme`
 * cookie for a flash-free first paint.
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
        name: "app-nav",
        content: appNavCss(),
        order: 3,
      },
      {
        name: "vaults-layout",
        content: vaultsLayoutCss,
        order: 4,
      },
    ],
    i18n: [
      {
        locale: "en-US",
        namespace: "vaults",
        messages: { title: vaultsSeoCopy.title },
        order: 5,
      },
      {
        locale: "zh-CN",
        namespace: "vaults",
        messages: { title: "MVP 永续 — 金库" },
        order: 6,
      },
    ],
  }),
);

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const theme = readThemePreference(cookieHeader);
  const locale = resolveLocalePreference({ cookieHeader });

  return (
    <html lang={LOCALE_LANG[locale]} data-theme={theme}>
      <head>
        {assetTags.map((tag) => (
          <AssetTag key={assetTagKey(tag)} tag={tag} />
        ))}
      </head>
      <body>
        <AppNav currentPath="/vaults" theme={theme} locale={locale} />
        {children}
      </body>
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
