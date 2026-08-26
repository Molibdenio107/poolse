import en from '../messages/en.json';
import pt from '../messages/pt-PT.json';

export type MarketingLocale = 'pt-PT' | 'en';

/** The other locale, for the switcher. Two languages, so this is a flip. */
export const OTHER: Record<MarketingLocale, { locale: MarketingLocale; href: string }> = {
  'pt-PT': { locale: 'en', href: '/en' },
  en: { locale: 'pt-PT', href: '/' },
};

const CATALOGUES: Record<MarketingLocale, unknown> = { 'pt-PT': pt, en };

/**
 * Translation lookup for the marketing pages, deliberately not next-intl's.
 *
 * `getRequestConfig` resolves the locale from a cookie, and reading a cookie
 * makes a page dynamic — which is exactly what these pages must not be. So the
 * catalogues are imported at module scope and the locale comes from the route:
 * `/` is Portuguese, `/en` is English, both prerendered at build time. Two URLs
 * also means two pages a search engine can index, which one cookie-switched URL
 * would not give us.
 *
 * The returned function is called `t` on purpose: `pnpm i18n:check` scans for
 * `t('…')`, so these strings are checked against both catalogues like every
 * other one in the app.
 */
export function translator(locale: MarketingLocale): (key: string) => string {
  const messages = CATALOGUES[locale];

  return function t(key: string): string {
    const value = key.split('.').reduce<unknown>((node, part) => {
      if (node !== null && typeof node === 'object' && part in node) {
        return (node as Record<string, unknown>)[part];
      }
      return undefined;
    }, messages);

    // Returning the key is what next-intl does, and it makes a missing string
    // obvious on screen rather than rendering an empty space nobody notices.
    return typeof value === 'string' ? value : key;
  };
}
