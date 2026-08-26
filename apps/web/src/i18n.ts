import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

/** Duplicated from lib/preferences.ts to keep this module free of a cycle. */
const LOCALE_COOKIE = 'poolse-locale';

export const locales = ['pt-PT', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'pt-PT';

/**
 * i18n is wired before the first screen exists, on purpose. Every user-facing
 * string goes through the translation layer as it is written — retrofitting this
 * across a built application is the task that eats a whole weekend.
 *
 * There is no `/[locale]/` route segment: Poolse resolves the locale from the
 * signed-in user's preference, not from the URL. An operator and their instructor
 * share one tenant and may read different languages, and nobody wants to bookmark
 * `/pt-PT/turmas`.
 */
export default getRequestConfig(async () => {
  // The cookie, not `requestLocale`: with no `/[locale]/` segment there is
  // nothing in the URL for next-intl to read, so that argument is always
  // undefined and every page rendered in the default language. See
  // lib/preferences.ts for why the cookie is the request-time source and
  // `app_user.locale` the durable one.
  const requested = (await cookies()).get(LOCALE_COOKIE)?.value;
  const resolved = (locales as readonly string[]).includes(requested ?? '')
    ? (requested as Locale)
    : defaultLocale;

  return {
    locale: resolved,
    messages: (await import(`./messages/${resolved}.json`)).default,
    timeZone: 'Europe/Lisbon',
  };
});
