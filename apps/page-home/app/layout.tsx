import {
  type AssetHtmlTag,
  collectAssets,
  createAssetHtmlTags,
} from "@mvp/assets";
import { RumBeacon } from "@mvp/runtime/rum";
import { readThemePreference, resolveLocalePreference } from "@mvp/trade-prefs";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { metadata } from "../src/metadata";

export { metadata };

const assetTags = createAssetHtmlTags(
  collectAssets({
    themes: [
      {
        name: "home-default",
        content:
          ":root{--mvp-font-body:system-ui,sans-serif;--mvp-page-accent:#0f766e}",
        order: 1,
      },
    ],
    i18n: [
      {
        locale: "en-US",
        namespace: "home",
        messages: { title: "MVP Storefront Home" },
        order: 2,
      },
      {
        locale: "zh-CN",
        namespace: "home",
        messages: { title: "MVP 商城首页" },
        order: 3,
      },
    ],
  }),
);

/** BCP-47 `<html lang>` tags for each short locale (the page owns this). */
const LOCALE_LANG = { en: "en-US", zh: "zh-CN" } as const;

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // The lang attribute must reflect the locale this response is rendered in.
  // It was hard-coded to "en" while this layout injected zh-CN copy through the
  // asset plane — a self-contradicting language signal on the site's most
  // important routes. The other five pages already resolved it from the cookie;
  // this brings these two in line.
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const theme = readThemePreference(cookieHeader);
  const locale = resolveLocalePreference({ cookieHeader });
  const resolvedTheme = theme === "light" ? "light" : "dark";

  return (
    <html lang={LOCALE_LANG[locale]} data-theme={resolvedTheme}>
      <head>
        {assetTags.map((tag) => (
          <AssetTag key={assetTagKey(tag)} tag={tag} />
        ))}
      </head>
      <body>
        {children}
        <RumBeacon />
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
