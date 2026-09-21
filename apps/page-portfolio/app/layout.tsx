import {
  type AssetHtmlTag,
  collectAssets,
  createAssetHtmlTags,
} from "@mvp/assets";
import { baseResetCss, createAllThemeVariables } from "@mvp/design-system";
import { RumBeacon } from "@mvp/runtime/rum";
import { readThemePreference, resolveLocalePreference } from "@mvp/trade-prefs";
import { createTradeAliasVariables } from "@mvp/trade-theme";
import { AppNav, appNavCss } from "@mvp/ui/AppNav";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { portfolioLayoutCss } from "../src/gridStyles";
import { metadata } from "../src/metadata";

export { metadata };

/** BCP-47 `<html lang>` tags for each short locale (page now owns this). */
const LOCALE_LANG = { en: "en-US", zh: "zh-CN" } as const;

/**
 * Theme + i18n asset tags for the portfolio page. The design-system is the
 * single CSS source (spine §11): we inject the base reset, all theme variable
 * blocks (light + dark, attribute-driven), the portfolio layout CSS, and the
 * shared `AppNav` stylesheet through the `@mvp/assets` plane.
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
        // D6 bridge: define the `--trade-*` vocabulary the SSR fragments read as
        // theme-aware aliases of `--mvp-color-*`, and swap the body font to the
        // sans control stack. Must sort AFTER the token block so its
        // `--mvp-font-body` override wins. See createTradeAliasVariables.
        name: "trade-token-bridge",
        content: createTradeAliasVariables(),
        order: 3,
      },
      {
        name: "app-nav",
        content: appNavCss(),
        order: 4,
      },
      {
        name: "portfolio-layout",
        content: portfolioLayoutCss,
        order: 5,
      },
    ],
    i18n: [
      {
        locale: "en-US",
        namespace: "portfolio",
        messages: { title: "MVP Perps — Portfolio" },
        order: 6,
      },
      {
        locale: "zh-CN",
        namespace: "portfolio",
        messages: { title: "MVP 永续 — 组合" },
        order: 7,
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
  // The trade terminal's native canvas is dark (Hyperliquid parity): render dark
  // unless the user explicitly opted into light. `system`/unset → dark.
  const resolvedTheme = theme === "light" ? "light" : "dark";

  return (
    <html lang={LOCALE_LANG[locale]} data-theme={resolvedTheme}>
      <head>
        {assetTags.map((tag) => (
          <AssetTag key={assetTagKey(tag)} tag={tag} />
        ))}
      </head>
      <body>
        <AppNav
          currentPath="/portfolio"
          theme={resolvedTheme}
          locale={locale}
        />
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
