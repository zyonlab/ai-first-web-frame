/**
 * Shell locale helper.
 *
 * The shell is now a **transparent proxy**: each composed Next page renders its
 * own navigation chrome + flash-free theme/i18n head inside its own React tree
 * (see `@mvp/ui` `AppNav`), so the shell no longer wraps upstream HTML. That
 * migration fixed a Next hydration mismatch (React #418) caused by the shell
 * mutating the page's SSR DOM.
 *
 * The one piece still owned here is the short-locale -> BCP-47 mapping, used by
 * `context.ts` to forward the resolved `x-locale` header to page units.
 */

import type { LocalePreference } from "@mvp/trade-prefs";

/** BCP-47 tags emitted on `<html lang>` for each short locale. */
const LOCALE_LANG: Record<LocalePreference, string> = {
  en: "en-US",
  zh: "zh-CN",
};

/** Map a short locale to its BCP-47 `<html lang>` tag. */
export function localeToLang(locale: LocalePreference): string {
  return LOCALE_LANG[locale] ?? LOCALE_LANG.en;
}
