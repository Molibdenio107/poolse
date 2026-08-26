import { cookies } from 'next/headers';
import { defaultLocale, locales, type Locale } from '../i18n';
import { defaultTheme, isTheme, THEME_COOKIE, type Theme } from './theme';

// Re-exported so server modules have one import for both preferences.
export { defaultTheme, isTheme, THEME_COOKIE, THEMES, type Theme } from './theme';

export const LOCALE_COOKIE = 'poolse-locale';

/**
 * Both preferences live in a cookie, and the durable copy lives on `app_user`.
 *
 * The cookie is what renders the page, because it is the only one of the two the
 * server can read without a round trip on every request. The database column is
 * what makes the choice follow the person to a second device — it seeds the
 * cookie when they sign in there (see LocaleSync).
 *
 * A year, because these are conveniences: the worst case for a stale cookie is
 * a page in the wrong language until the next sign-in, and the shortest sensible
 * alternative would log everyone back into Portuguese every session.
 */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const base = {
  path: '/',
  maxAge: ONE_YEAR_SECONDS,
  sameSite: 'lax',
} as const;

/**
 * The locale cookie is read on the server, by `getRequestConfig`, and nothing in
 * the browser needs it.
 */
export const localeCookieOptions = { ...base, httpOnly: true } as const;

/**
 * The theme cookie is deliberately readable by JavaScript, and that is a design
 * decision rather than an oversight.
 *
 * The marketing pages are statically rendered — reading a cookie on the server
 * would make them dynamic, which is the thing they must not be. So the theme is
 * applied before first paint by a tiny inline script that reads this cookie
 * itself. It is a display preference, not a secret; the cost of exposing it is
 * nothing and the alternative is either a flash of the wrong theme or a landing
 * page rendered on every request.
 */
export const themeCookieOptions = { ...base, httpOnly: false } as const;

export function isLocale(value: string | undefined): value is Locale {
  return (locales as readonly string[]).includes(value ?? '');
}

export async function readLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : defaultLocale;
}

export async function readTheme(): Promise<Theme> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : defaultTheme;
}
