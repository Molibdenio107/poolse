'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { apiPatch } from '../../lib/api';
import {
  isLocale,
  isTheme,
  localeCookieOptions,
  LOCALE_COOKIE,
  themeCookieOptions,
  THEME_COOKIE,
} from '../../lib/preferences';

/**
 * Writes a preference to the cookie that renders the page, and to `app_user` so
 * it survives a new browser.
 *
 * The cookie is written first and unconditionally. The API call is best-effort on
 * purpose: the theme toggle and the language switch sit on the public landing
 * page too, where there is no session to persist anything to, and a visitor
 * switching to English should get English rather than an error. The same
 * tolerance covers the API being down — the preference still applies to this
 * browser, which is the part the person can see.
 */
async function persist(locale?: string, theme?: string): Promise<void> {
  const store = await cookies();

  if (locale !== undefined && isLocale(locale)) store.set(LOCALE_COOKIE, locale, localeCookieOptions);
  if (theme !== undefined && isTheme(theme)) store.set(THEME_COOKIE, theme, themeCookieOptions);

  try {
    await apiPatch('/me/preferences', {
      ...(locale === undefined ? {} : { locale }),
      ...(theme === undefined ? {} : { theme }),
    });
  } catch {
    // Signed out, or the API is unreachable. The cookie already took effect.
  }

  // Every page renders through the locale and the theme, so all of them are now
  // stale — including the layout, which is why this is layout-deep rather than
  // one path.
  revalidatePath('/', 'layout');
}

export async function setLocaleAction(formData: FormData): Promise<void> {
  await persist(String(formData.get('locale') ?? ''), undefined);
}

export async function setThemeAction(formData: FormData): Promise<void> {
  await persist(undefined, String(formData.get('theme') ?? ''));
}

/**
 * Seeds the cookies from the stored preference when they disagree.
 *
 * Called once from the dashboard, which is where people land after signing in.
 * It exists because a cookie is per-browser and the column is per-person: on a
 * new device the cookie is absent, the page renders in the default language, and
 * without this the stored choice would never be applied.
 */
export async function syncPreferencesAction(locale: string, theme: string): Promise<void> {
  const store = await cookies();
  const currentLocale = store.get(LOCALE_COOKIE)?.value;
  const currentTheme = store.get(THEME_COOKIE)?.value;

  if (isLocale(locale) && currentLocale !== locale) store.set(LOCALE_COOKIE, locale, localeCookieOptions);
  if (isTheme(theme) && currentTheme !== theme) store.set(THEME_COOKIE, theme, themeCookieOptions);

  revalidatePath('/', 'layout');
}
